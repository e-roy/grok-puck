#include "link.h"

#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "link";

#define RETRY_MS 5000
#define RETRY_SLOW_MS 60000      // after the bridge refused this device
#define MAX_TEXT_BYTES 16384     // longest JSON message accepted

// Close codes the bridge uses (bridge/src/hub.ts).
#define CLOSE_UNKNOWN_KEY 4001
#define CLOSE_TOO_MANY_WAITING 4003
#define CLOSE_FORGOTTEN 4004

static esp_websocket_client_handle_t client;
static link_handlers_t on;
static char device_id[24];
static char firmware[48];
static char key[129];
static char *text;  // a text message arriving in parts

// The Wi-Fi report (set from the Wi-Fi task, read on the link's task).
static SemaphoreHandle_t wifi_lock;
static link_wifi_t wifi;
static bool have_wifi;
// A bridge older than this firmware answers a `wifi` message with "unrecognised message". Then no
// more are sent on that connection; its hello still carries the report, which it ignores.
static volatile bool bridge_takes_wifi = true;

static bool send_json(cJSON *message) {
    char *s = cJSON_PrintUnformatted(message);
    cJSON_Delete(message);
    if (!s) return false;
    bool sent = false;
    if (client && esp_websocket_client_is_connected(client)) {
        sent = esp_websocket_client_send_text(client, s, strlen(s), pdMS_TO_TICKS(2000)) >= 0;
    }
    cJSON_free(s);
    return sent;
}

static cJSON *message(const char *type) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", type);
    return m;
}

// {"saved": [...], "current": "..." | null, "rssi": -58 | null, "setup": false}, into `m`.
static void add_wifi(cJSON *m, const link_wifi_t *w) {
    cJSON *saved = cJSON_AddArrayToObject(m, "saved");
    for (int i = 0; i < w->count; i++) cJSON_AddItemToArray(saved, cJSON_CreateString(w->saved[i]));
    if (w->current[0]) {
        cJSON_AddStringToObject(m, "current", w->current);
        cJSON_AddNumberToObject(m, "rssi", w->rssi);
    } else {
        cJSON_AddNullToObject(m, "current");
        cJSON_AddNullToObject(m, "rssi");
    }
    cJSON_AddBoolToObject(m, "setup", w->setup);
}

static void send_hello(void) {
    cJSON *m = message("hello");
    cJSON_AddStringToObject(m, "device_id", device_id);
    cJSON_AddStringToObject(m, "firmware", firmware);
    if (key[0]) cJSON_AddStringToObject(m, "key", key);
    xSemaphoreTake(wifi_lock, portMAX_DELAY);
    if (have_wifi) add_wifi(cJSON_AddObjectToObject(m, "wifi"), &wifi);
    xSemaphoreGive(wifi_lock);
    send_json(m);
}

void link_set_wifi(const link_wifi_t *w) {
    // Created by whichever comes first; both this and link_start() run on the Wi-Fi task.
    if (!wifi_lock) wifi_lock = xSemaphoreCreateMutex();
    xSemaphoreTake(wifi_lock, portMAX_DELAY);
    const bool changed = !have_wifi || memcmp(&wifi, w, sizeof(wifi)) != 0;
    wifi = *w;
    have_wifi = true;
    cJSON *m = NULL;
    if (changed && bridge_takes_wifi && client && esp_websocket_client_is_connected(client)) {
        m = message("wifi");
        add_wifi(m, &wifi);
    }
    xSemaphoreGive(wifi_lock);
    if (m) send_json(m);
}

void link_send_played(const char *id, bool stopped) {
    cJSON *m = message("played");
    cJSON_AddStringToObject(m, "id", id);
    cJSON_AddBoolToObject(m, "stopped", stopped);
    send_json(m);
}

void link_send_stop(void) { send_json(message("stop")); }

bool link_send_listen_start(void) {
    cJSON *m = message("listen.start");
    cJSON_AddNumberToObject(m, "sample_rate", 16000);
    return send_json(m);
}

bool link_send_audio(const int16_t *pcm, size_t samples) {
    if (!client || !esp_websocket_client_is_connected(client)) return false;
    return esp_websocket_client_send_bin(client, (const char *)pcm, samples * sizeof(int16_t), pdMS_TO_TICKS(1000)) >= 0;
}

bool link_send_listen_end(bool cancel) { return send_json(message(cancel ? "listen.cancel" : "listen.end")); }

static const char *string_of(const cJSON *object, const char *name) {
    const char *s = cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(object, name));
    return s ? s : "";
}

static void read_config(const cJSON *m) {
    link_config_t c = {.volume = 70, .max_listen_ms = 60000};
    snprintf(c.name, sizeof(c.name), "%s", string_of(m, "name"));
    const cJSON *volume = cJSON_GetObjectItemCaseSensitive(m, "volume");
    if (cJSON_IsNumber(volume)) c.volume = volume->valueint;
    c.muted = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(m, "muted"));
    const cJSON *timings = cJSON_GetObjectItemCaseSensitive(m, "timings");
    const cJSON *max_listen = cJSON_GetObjectItemCaseSensitive(timings, "maxListenMs");
    if (cJSON_IsNumber(max_listen)) c.max_listen_ms = max_listen->valueint;
    const cJSON *bot = cJSON_GetObjectItemCaseSensitive(m, "bot");
    const cJSON *avatar = cJSON_GetObjectItemCaseSensitive(bot, "avatar");
    const char *color = string_of(avatar, "color");
    if (cJSON_IsObject(avatar) && color[0] == '#' && strlen(color) == 7) {
        c.has_avatar = true;
        snprintf(c.shape, sizeof(c.shape), "%s", string_of(avatar, "shape"));
        c.color = strtoul(color + 1, NULL, 16);
    }
    on.config(&c);
}

static void handle_text(const char *json, size_t len) {
    cJSON *m = cJSON_ParseWithLength(json, len);
    const char *type = string_of(m, "type");
    if (!strcmp(type, "pending")) {
        ESP_LOGI(TAG, "waiting for approval in the admin page (device %s)", device_id);
        on.status(LINK_PENDING);
    } else if (!strcmp(type, "welcome")) {
        snprintf(key, sizeof(key), "%s", string_of(m, "key"));
        ESP_LOGI(TAG, "approved");
        on.welcome(key);
    } else if (!strcmp(type, "config")) {
        read_config(m);
        on.status(LINK_ONLINE);
    } else if (!strcmp(type, "show")) {
        on.show(string_of(m, "state"));
    } else if (!strcmp(type, "play.start")) {
        const cJSON *rate = cJSON_GetObjectItemCaseSensitive(m, "sample_rate");
        on.play_start(string_of(m, "id"), cJSON_IsNumber(rate) ? rate->valueint : 0);
    } else if (!strcmp(type, "play.end")) {
        on.play_end(string_of(m, "id"));
    } else if (!strcmp(type, "stop")) {
        on.stop();
    } else if (!strcmp(type, "wifi.setup")) {
        ESP_LOGI(TAG, "the admin page asked for the Wi-Fi setup network");
        on.wifi_setup();
    } else if (!strcmp(type, "wifi.forget_network")) {
        ESP_LOGW(TAG, "the admin page asked this device to forget one of its Wi-Fi networks");
        on.forget_network(string_of(m, "ssid"));
    } else if (!strcmp(type, "wifi.forget")) {
        ESP_LOGW(TAG, "the admin page asked this device to forget all its Wi-Fi networks");
        on.forget_wifi();
    } else if (!strcmp(type, "error")) {
        const char *said = string_of(m, "message");
        ESP_LOGW(TAG, "the bridge says: %s", said);
        if (!strcmp(said, "unrecognised message") && bridge_takes_wifi) {
            // The only message this firmware sends that an older bridge doesn't know.
            bridge_takes_wifi = false;
            ESP_LOGI(TAG, "this bridge is older than the firmware: no Wi-Fi updates until it reconnects");
        }
    } else {
        ESP_LOGW(TAG, "unknown message from the bridge: %.40s", type[0] ? type : "(not JSON)");
    }
    cJSON_Delete(m);
}

static void on_data(const esp_websocket_event_data_t *e) {
    if (e->op_code == WS_TRANSPORT_OPCODES_BINARY) {
        if (e->data_len > 0) on.audio((const uint8_t *)e->data_ptr, e->data_len);
        return;
    }
    if (e->op_code != WS_TRANSPORT_OPCODES_TEXT || e->data_len <= 0) return;  // ping, pong, close
    if (e->payload_offset == 0 && e->data_len >= e->payload_len) {
        handle_text(e->data_ptr, e->data_len);
        return;
    }
    // A longer message, delivered in parts.
    if (e->payload_offset == 0) {
        free(text);
        text = e->payload_len <= MAX_TEXT_BYTES ? malloc(e->payload_len) : NULL;
    }
    if (!text || e->payload_offset + e->data_len > e->payload_len) return;
    memcpy(text + e->payload_offset, e->data_ptr, e->data_len);
    if (e->payload_offset + e->data_len == e->payload_len) {
        handle_text(text, e->payload_len);
        free(text);
        text = NULL;
    }
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    const esp_websocket_event_data_t *e = data;
    switch (id) {
        case WEBSOCKET_EVENT_CONNECTED:
            ESP_LOGI(TAG, "connected to the bridge");
            esp_websocket_client_set_reconnect_timeout(client, RETRY_MS);
            bridge_takes_wifi = true;  // perhaps a newer bridge now
            send_hello();
            break;
        case WEBSOCKET_EVENT_DATA:
            on_data(e);
            break;
        case WEBSOCKET_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "no link to the bridge; retrying in %d s", esp_websocket_client_get_reconnect_timeout(client) / 1000);
            on.status(LINK_CONNECTING);
            break;
        case WEBSOCKET_EVENT_CLOSED:
            switch (e->close_status_code) {
                case CLOSE_UNKNOWN_KEY:
                    ESP_LOGE(TAG, "the bridge doesn't know this device's key: forget it in the admin page, then approve it again");
                    esp_websocket_client_set_reconnect_timeout(client, RETRY_SLOW_MS);
                    on.status(LINK_REJECTED);
                    break;
                case CLOSE_FORGOTTEN:
                    ESP_LOGW(TAG, "the bridge forgot this device; it will ask for approval again");
                    key[0] = '\0';
                    on.forgotten();
                    on.status(LINK_CONNECTING);
                    break;
                case CLOSE_TOO_MANY_WAITING:
                    ESP_LOGW(TAG, "the bridge has too many devices waiting for approval");
                    esp_websocket_client_set_reconnect_timeout(client, RETRY_SLOW_MS);
                    on.status(LINK_CONNECTING);
                    break;
                default:
                    ESP_LOGW(TAG, "the bridge closed the link (%d); reconnecting", e->close_status_code);
                    on.status(LINK_CONNECTING);
            }
            break;
        case WEBSOCKET_EVENT_ERROR:
            // 101 is a successful upgrade (and may be left over from an earlier connection).
            if (e->error_handle.esp_ws_handshake_status_code && e->error_handle.esp_ws_handshake_status_code != 101) {
                ESP_LOGW(TAG, "the bridge answered HTTP %d: is the address right (it ends in /device)?",
                         e->error_handle.esp_ws_handshake_status_code);
            }
            break;
        default:
            break;
    }
}

esp_err_t link_start(const char *url, const char *id, const char *fw, const char *device_key,
                     const link_handlers_t *handlers) {
    if (client) return ESP_OK;
    if (!wifi_lock) wifi_lock = xSemaphoreCreateMutex();
    on = *handlers;
    snprintf(device_id, sizeof(device_id), "%s", id);
    snprintf(firmware, sizeof(firmware), "%s", fw);
    snprintf(key, sizeof(key), "%s", device_key);
    const esp_websocket_client_config_t cfg = {
        .uri = url,
        .user_agent = firmware,
        .task_stack = 6144,
        .task_prio = 6,
        .buffer_size = 2048,
        .crt_bundle_attach = esp_crt_bundle_attach,  // wss:// through the tunnel: public certificates
        .reconnect_timeout_ms = RETRY_MS,
        .network_timeout_ms = 10000,
        .enable_close_reconnect = true,
        .ping_interval_sec = 20,
        .pingpong_timeout_sec = 60,
        .keep_alive_enable = true,
        .keep_alive_idle = 10,
        .keep_alive_interval = 5,
        .keep_alive_count = 3,
    };
    client = esp_websocket_client_init(&cfg);
    if (!client) return ESP_FAIL;
    esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, on_event, NULL);
    ESP_LOGI(TAG, "connecting to %s", url);
    return esp_websocket_client_start(client);
}
