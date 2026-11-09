// Desk display firmware: Wi-Fi setup from a phone, the link to the bridge (approval, avatar and volume
// from the admin page, states), the bot's speech played as it streams in, and hold to talk.
//
// Touch: hold the screen to talk and let go to send (a hold while the bot speaks stops it first).
// A tap stops speech, or gets a small reaction.
#include <math.h>
#include <string.h>

#include "audio.h"
#include "board.h"
#include "esp_app_desc.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "link.h"
#include "listen.h"
#include "net.h"
#include "player.h"
#include "settings.h"

static const char *TAG = "desk";

#define HOLD_MS 300  // a press this long is a hold; shorter is a tap
#define BLOCK_SAMPLES (AUDIO_SPEAKER_RATE / 50)  // 20 ms

static settings_t settings;
static char firmware[48];

// What the face should show, from these inputs. Changed only with the LVGL lock held.
static bool on_wifi;
static bool in_setup;
static link_status_t link_status = LINK_CONNECTING;
static face_state_t bridge_state = FACE_IDLE;  // what the bridge last asked for
static bool speaking;
static bool listening;

static void refresh_face(void) {
    face_state_t want;
    if (!on_wifi || link_status == LINK_CONNECTING) {
        want = FACE_OFFLINE;
    } else if (link_status == LINK_PENDING) {
        want = FACE_WAITING;  // waiting for approval in the admin page
    } else if (link_status == LINK_REJECTED) {
        want = FACE_ERROR;
    } else if (listening) {
        want = FACE_LISTENING;
    } else if (speaking) {
        want = FACE_SPEAKING;
    } else {
        want = bridge_state;
    }
    if (face_get_state() != want) face_set_state(want);
}

// ---- the bridge ----

static void on_status(link_status_t status) {
    if (status == LINK_CONNECTING && player_stop()) ESP_LOGI(TAG, "link lost: speech stopped");
    lvgl_port_lock(0);
    link_status = status;
    if (status == LINK_CONNECTING) speaking = false;
    refresh_face();
    lvgl_port_unlock();
}

static void on_welcome(const char *key) {
    if (settings_save_key(key) != ESP_OK) ESP_LOGE(TAG, "could not save the device key");
}

static void on_forgotten(void) { settings_save_key(""); }

static void on_config(const link_config_t *c) {
    audio_set_volume(c->volume);
    listen_set_max_ms(c->max_listen_ms);
    face_shape_t new_shape = face_get_shape();
    uint32_t new_color = face_get_color();
    if (c->has_avatar) {
        const face_shape_t s = face_shape_from_name(c->shape);
        if (s < FACE_SHAPE_COUNT) new_shape = s;
        new_color = c->color;
    }
    ESP_LOGI(TAG, "config: \"%s\", %s #%06lx, volume %d%s", c->name, face_shape_name(new_shape), (unsigned long)new_color,
             c->volume, c->muted ? ", muted" : "");
    if (new_shape != face_get_shape() || new_color != face_get_color()) {
        lvgl_port_lock(0);
        face_set_avatar(new_shape, new_color);  // redraws the body: under a second
        lvgl_port_unlock();
    }
    if (new_shape != settings.shape || new_color != settings.color || c->volume != settings.volume ||
        c->muted != settings.muted) {
        settings.shape = new_shape;
        settings.color = new_color;
        settings.volume = c->volume;
        settings.muted = c->muted;
        settings_save_look(new_shape, new_color, c->volume, c->muted);
    }
}

static void on_show(const char *name) {
    static const struct {
        const char *name;
        face_state_t state;
    } states[] = {{"idle", FACE_IDLE}, {"thinking", FACE_THINKING}, {"working", FACE_WORKING},
                  {"waiting", FACE_WAITING}, {"error", FACE_ERROR}};
    for (size_t i = 0; i < sizeof(states) / sizeof(states[0]); i++) {
        if (strcmp(name, states[i].name) != 0) continue;
        lvgl_port_lock(0);
        bridge_state = states[i].state;
        refresh_face();
        lvgl_port_unlock();
        return;
    }
    ESP_LOGW(TAG, "the bridge asked for an unknown state: %s", name);
}

static void on_play_start(const char *id, int sample_rate) {
    if (sample_rate != AUDIO_SPEAKER_RATE) ESP_LOGW(TAG, "clip at %d Hz; the speaker runs at %d", sample_rate, AUDIO_SPEAKER_RATE);
    player_begin(id);
    lvgl_port_lock(0);
    speaking = true;
    refresh_face();
    lvgl_port_unlock();
}

static void on_stop(void) {
    player_stop();
    lvgl_port_lock(0);
    speaking = false;
    refresh_face();
    lvgl_port_unlock();
}

static void restart(void *arg) {
    (void)arg;
    esp_restart();
}

static void on_forget_wifi(void) {
    settings_forget_wifi();
    // Restart a moment later, outside the link's task; setup opens at once (no network saved).
    const esp_timer_create_args_t args = {.callback = restart, .name = "restart"};
    esp_timer_handle_t timer;
    if (esp_timer_create(&args, &timer) == ESP_OK) esp_timer_start_once(timer, 500 * 1000);
}

static const link_handlers_t LINK_HANDLERS = {
    .status = on_status,
    .welcome = on_welcome,
    .forgotten = on_forgotten,
    .config = on_config,
    .show = on_show,
    .play_start = on_play_start,
    .audio = player_write,
    .play_end = player_end,
    .stop = on_stop,
    .forget_wifi = on_forget_wifi,
};

// ---- Wi-Fi ----

static void on_net(net_state_t state) {
    lvgl_port_lock(0);
    in_setup = state == NET_SETUP;
    on_wifi = state == NET_ONLINE;
    if (in_setup) {
        face_show_setup(net_setup_ssid(), net_setup_password());
    } else {
        face_hide_setup();
    }
    refresh_face();
    lvgl_port_unlock();
    if (state == NET_ONLINE) {
        if (settings.bridge_url[0] == '\0') {
            ESP_LOGE(TAG, "no bridge address saved; forget the Wi-Fi to run setup again");
            return;
        }
        link_start(settings.bridge_url, net_device_id(), firmware, settings.device_key, &LINK_HANDLERS);
    }
}

// ---- touch ----

// With the LVGL lock held (LVGL callbacks).
static void stop_speaking(void) {
    if (!player_stop()) return;
    link_send_stop();
    speaking = false;
    refresh_face();
    ESP_LOGI(TAG, "speech stopped by touch");
}

static void on_screen(lv_event_t *e) {
    switch (lv_event_get_code(e)) {
        case LV_EVENT_PRESSED:
            listen_press();  // records from here, so the first word isn't cut off while the hold counts
            break;
        case LV_EVENT_LONG_PRESSED:
            if (on_wifi && link_status == LINK_ONLINE) {
                listen_hold();
            } else {
                face_poke();  // no bridge to talk to
            }
            break;
        case LV_EVENT_SHORT_CLICKED:
            if (speaking) {
                stop_speaking();
            } else {
                face_poke();
            }
            break;
        case LV_EVENT_RELEASED:
        case LV_EVENT_PRESS_LOST:
            listen_release();
            break;
        default:
            break;
    }
}

// ---- listening (on the listen task) ----

static void on_listen_started(void) {
    player_stop();  // the bridge stops the clip too when listening starts
    lvgl_port_lock(0);
    speaking = false;
    listening = true;
    refresh_face();
    lvgl_port_unlock();
}

static void on_listen_finished(bool sent) {
    lvgl_port_lock(0);
    listening = false;
    if (sent) bridge_state = FACE_THINKING;  // at once; the bridge confirms it, or says otherwise
    refresh_face();
    lvgl_port_unlock();
}

// ---- audio ----

static void audio_task(void *arg) {
    (void)arg;
    static int16_t buf[BLOCK_SAMPLES];
    bool playing = false;
    for (;;) {
        bool finished = false;
        char id[24];
        const size_t n = player_read(buf, BLOCK_SAMPLES, &finished, id, sizeof(id));
        if (n > 0) {
            playing = true;
            face_set_level(audio_meter(audio_level(buf, n)));
            audio_play(buf, n);
            continue;
        }
        if (playing) face_set_level(0);  // once: the listen task sets the level while listening
        playing = false;
        if (finished) {
            link_send_played(id, false);
            lvgl_port_lock(0);
            speaking = false;
            refresh_face();
            lvgl_port_unlock();
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void app_main(void) {
    snprintf(firmware, sizeof(firmware), "desk-display/%s", esp_app_get_description()->version);
    ESP_LOGI(TAG, "%s", firmware);
    ESP_ERROR_CHECK(board_init());
    ESP_ERROR_CHECK(audio_init());
    ESP_ERROR_CHECK(settings_init());
    settings_load(&settings);
    audio_set_volume(settings.volume);
    ESP_ERROR_CHECK(player_init());

    lvgl_port_lock(0);
    face_create(lv_screen_active());
    face_set_avatar(settings.shape < FACE_SHAPE_COUNT ? (face_shape_t)settings.shape : FACE_BLOB, settings.color);
    face_set_state(FACE_OFFLINE);
    for (lv_indev_t *indev = lv_indev_get_next(NULL); indev; indev = lv_indev_get_next(indev)) {
        lv_indev_set_long_press_time(indev, HOLD_MS);
    }
    static const lv_event_code_t TOUCH_EVENTS[] = {LV_EVENT_PRESSED, LV_EVENT_LONG_PRESSED, LV_EVENT_SHORT_CLICKED,
                                                   LV_EVENT_RELEASED, LV_EVENT_PRESS_LOST};
    for (size_t i = 0; i < sizeof(TOUCH_EVENTS) / sizeof(TOUCH_EVENTS[0]); i++) {
        lv_obj_add_event_cb(lv_screen_active(), on_screen, TOUCH_EVENTS[i], NULL);
    }
    lvgl_port_unlock();

    vTaskDelay(pdMS_TO_TICKS(120));  // first frame drawn before the backlight comes on
    board_set_backlight(80);
    xTaskCreatePinnedToCore(audio_task, "audio", 6144, NULL, 5, NULL, 1);
    static const listen_handlers_t LISTEN_HANDLERS = {.started = on_listen_started, .finished = on_listen_finished};
    ESP_ERROR_CHECK(listen_init(&LISTEN_HANDLERS));

    ESP_ERROR_CHECK(net_start(&settings, on_net));
    ESP_LOGI(TAG, "device %s", net_device_id());

    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(60000));
        ESP_LOGI(TAG, "free memory: internal %u bytes, PSRAM %u bytes", (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                 (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    }
}
