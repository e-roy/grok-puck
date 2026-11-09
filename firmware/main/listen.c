#include "listen.h"

#include <stdatomic.h>
#include <string.h>

#include "audio.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "link.h"

static const char *TAG = "listen";

#define BLOCK_MS 20
#define BLOCK_SAMPLES (AUDIO_MIC_RATE * BLOCK_MS / 1000)  // 320
#define FRAME_BLOCKS 5                                    // 100 ms per WebSocket frame
#define PREROLL_BLOCKS 40   // up to 0.8 s kept from before the touch counted as a hold
#define MIN_VOICE_MS 300    // less voice than this is an accidental touch: nothing is sent
#define VOICE_DB -26.0f     // a block louder than this counts as voice (room -35..-44 dB, voice -15..-23)

typedef enum { CMD_PRESS, CMD_HOLD, CMD_RELEASE } cmd_t;

static QueueHandle_t commands;
static listen_handlers_t on;
static atomic_int max_ms = 60000;
static int16_t *preroll;                          // PREROLL_BLOCKS blocks, a ring
static int16_t frame[FRAME_BLOCKS * BLOCK_SAMPLES];  // only the listen task uses it

static void command(cmd_t c) {
    if (commands) xQueueSend(commands, &c, 0);
}

void listen_press(void) { command(CMD_PRESS); }
void listen_hold(void) { command(CMD_HOLD); }
void listen_release(void) { command(CMD_RELEASE); }
void listen_set_max_ms(int ms) { atomic_store(&max_ms, ms > 1000 ? ms : 1000); }

static bool is_voice(const int16_t *pcm, float *level) {
    const float rms = audio_level(pcm, BLOCK_SAMPLES);
    *level = audio_meter(rms);
    return audio_db(rms) > VOICE_DB;
}

// Records until the touch becomes a hold (true) or ends (false). Keeps the latest blocks in the ring.
static bool record_until_hold(size_t *recorded) {
    *recorded = 0;
    for (;;) {
        cmd_t c;
        while (xQueueReceive(commands, &c, 0) == pdTRUE) {
            if (c == CMD_HOLD) return true;
            if (c == CMD_RELEASE) return false;
            *recorded = 0;  // a new press: start over
        }
        int16_t *block = preroll + (*recorded % PREROLL_BLOCKS) * BLOCK_SAMPLES;
        if (audio_record(block, BLOCK_SAMPLES, 100) == BLOCK_SAMPLES) (*recorded)++;
    }
}

typedef struct {
    size_t blocks;    // in the frame being filled
    int voice_ms;
    int total_ms;
    bool link_ok;
} stream_t;

// Adds one block to the outgoing frame, sending the frame when it is full.
static void add_block(stream_t *s, const int16_t *block) {
    float level;
    if (is_voice(block, &level)) s->voice_ms += BLOCK_MS;
    s->total_ms += BLOCK_MS;
    face_set_level(level);
    memcpy(frame + s->blocks * BLOCK_SAMPLES, block, sizeof(int16_t) * BLOCK_SAMPLES);
    if (++s->blocks == FRAME_BLOCKS) {
        if (s->link_ok && !link_send_audio(frame, FRAME_BLOCKS * BLOCK_SAMPLES)) s->link_ok = false;
        s->blocks = 0;
    }
}

static void stream(size_t recorded) {
    on.started();
    stream_t s = {.link_ok = link_send_listen_start()};
    // What was recorded before the hold counted, oldest first.
    const size_t kept = recorded < PREROLL_BLOCKS ? recorded : PREROLL_BLOCKS;
    for (size_t i = recorded - kept; i < recorded; i++) add_block(&s, preroll + (i % PREROLL_BLOCKS) * BLOCK_SAMPLES);

    static int16_t block[BLOCK_SAMPLES];
    const int limit_ms = atomic_load(&max_ms);
    bool released = false;
    while (!released && s.link_ok && s.total_ms < limit_ms) {
        cmd_t c;
        while (xQueueReceive(commands, &c, 0) == pdTRUE) {
            if (c == CMD_RELEASE) released = true;
        }
        if (!released && audio_record(block, BLOCK_SAMPLES, 100) == BLOCK_SAMPLES) add_block(&s, block);
    }
    if (s.link_ok && s.blocks) s.link_ok = link_send_audio(frame, s.blocks * BLOCK_SAMPLES);
    face_set_level(0);

    const bool send = s.link_ok && s.voice_ms >= MIN_VOICE_MS;
    if (s.link_ok) link_send_listen_end(!send);
    if (!s.link_ok) {
        ESP_LOGW(TAG, "the link dropped while listening; nothing sent");
    } else if (send) {
        ESP_LOGI(TAG, "sent %d ms (%d ms of voice)%s", s.total_ms, s.voice_ms, released ? "" : ", the longest message");
    } else {
        ESP_LOGI(TAG, "only %d ms of voice: nothing sent", s.voice_ms);
    }
    on.finished(send);
    // At the longest message the finger may still be down: wait for it to lift.
    if (!released) {
        cmd_t c;
        while (xQueueReceive(commands, &c, portMAX_DELAY) == pdTRUE && c != CMD_RELEASE) {
        }
    }
}

static void listen_task(void *arg) {
    (void)arg;
    for (;;) {
        cmd_t c;
        if (xQueueReceive(commands, &c, portMAX_DELAY) != pdTRUE || c != CMD_PRESS) continue;
        size_t recorded;
        if (record_until_hold(&recorded)) stream(recorded);
    }
}

esp_err_t listen_init(const listen_handlers_t *handlers) {
    on = *handlers;
    preroll = heap_caps_malloc(sizeof(int16_t) * PREROLL_BLOCKS * BLOCK_SAMPLES, MALLOC_CAP_SPIRAM);
    commands = xQueueCreate(8, sizeof(cmd_t));
    if (!preroll || !commands) return ESP_ERR_NO_MEM;
    return xTaskCreatePinnedToCore(listen_task, "listen", 4096, NULL, 5, NULL, 0) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}
