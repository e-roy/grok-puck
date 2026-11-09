#include "player.h"

#include <stdio.h>
#include <string.h>

#include "audio.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/stream_buffer.h"

static const char *TAG = "player";

#define BUFFER_BYTES (AUDIO_SPEAKER_RATE * 2 * 3)  // 3 s; the bridge stays about 1 s ahead
#define PRIME_BYTES (AUDIO_SPEAKER_RATE * 2 / 5)   // 200 ms buffered before playing starts

static StreamBufferHandle_t buffer;
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static char clip_id[24];
static bool accepting;  // audio for clip_id is still arriving
static bool active;     // a clip is buffered or playing
static bool ended;      // play.end has arrived
static bool primed;
static bool flush;      // drop what is buffered (done by the reader, which may reset the buffer)

esp_err_t player_init(void) {
    buffer = xStreamBufferCreateWithCaps(BUFFER_BYTES, 1, MALLOC_CAP_SPIRAM);
    return buffer ? ESP_OK : ESP_ERR_NO_MEM;
}

static void copy_id(char *to, size_t size, const char *from) {
    size_t n = 0;
    while (from[n] && n + 1 < size) {
        to[n] = from[n];
        n++;
    }
    to[n] = '\0';
}

void player_begin(const char *id) {
    char new_id[sizeof(clip_id)];
    copy_id(new_id, sizeof(new_id), id);
    portENTER_CRITICAL(&lock);
    accepting = active = false;
    portEXIT_CRITICAL(&lock);
    // Empty the buffer here, not in the reader: the clip's first second arrives right after this.
    // The link task is the only writer and is here, so nothing waits on the buffer.
    const bool emptied = xStreamBufferReset(buffer) == pdPASS;
    portENTER_CRITICAL(&lock);
    copy_id(clip_id, sizeof(clip_id), new_id);
    accepting = active = true;
    ended = primed = false;
    flush = !emptied;
    portEXIT_CRITICAL(&lock);
}

void player_write(const uint8_t *pcm, size_t bytes) {
    portENTER_CRITICAL(&lock);
    const bool take = accepting;
    portEXIT_CRITICAL(&lock);
    if (!take) return;
    // Waits a little if the buffer is full; the bridge's pacing should keep it from filling.
    const size_t sent = xStreamBufferSend(buffer, pcm, bytes, pdMS_TO_TICKS(500));
    if (sent < bytes) ESP_LOGW(TAG, "buffer full: %u bytes dropped", (unsigned)(bytes - sent));
}

void player_end(const char *id) {
    portENTER_CRITICAL(&lock);
    if (accepting && strcmp(id, clip_id) == 0) {
        accepting = false;
        ended = true;
    }
    portEXIT_CRITICAL(&lock);
}

bool player_stop(void) {
    portENTER_CRITICAL(&lock);
    const bool was_active = active;
    accepting = active = ended = primed = false;
    flush = true;
    portEXIT_CRITICAL(&lock);
    return was_active;
}

bool player_busy(void) {
    portENTER_CRITICAL(&lock);
    const bool busy = active;
    portEXIT_CRITICAL(&lock);
    return busy;
}

size_t player_read(int16_t *pcm, size_t samples, bool *finished, char *finished_id, size_t id_size) {
    *finished = false;
    portENTER_CRITICAL(&lock);
    const bool do_flush = flush;
    flush = false;
    portEXIT_CRITICAL(&lock);
    if (do_flush && xStreamBufferReset(buffer) != pdPASS) {
        // A writer is waiting on the full buffer: empty it by reading instead.
        while (xStreamBufferReceive(buffer, pcm, samples * sizeof(int16_t), 0) > 0) {
        }
    }

    portENTER_CRITICAL(&lock);
    const bool is_active = active, has_ended = ended;
    bool is_primed = primed;
    portEXIT_CRITICAL(&lock);
    if (!is_active) return 0;

    if (!is_primed) {
        if (xStreamBufferBytesAvailable(buffer) < PRIME_BYTES && !has_ended) return 0;
        portENTER_CRITICAL(&lock);
        primed = true;
        portEXIT_CRITICAL(&lock);
    }
    const size_t got = xStreamBufferReceive(buffer, pcm, samples * sizeof(int16_t), 0) / sizeof(int16_t);
    if (got == 0 && has_ended) {
        char id[sizeof(clip_id)];
        portENTER_CRITICAL(&lock);
        const bool still_this_clip = active && ended;  // not stopped or replaced meanwhile
        if (still_this_clip) {
            active = false;
            copy_id(id, sizeof(id), clip_id);
        }
        portEXIT_CRITICAL(&lock);
        if (still_this_clip) copy_id(finished_id, id_size, id);
        *finished = still_this_clip;
    }
    return got;
}
