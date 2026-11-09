// The link to the bridge: one WebSocket with JSON messages and binary audio (bridge/src/protocol.ts
// is the other side). It reconnects by itself; the handlers run on the link's task.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef enum {
    LINK_CONNECTING,  // no link to the bridge
    LINK_PENDING,     // connected, waiting for approval in the admin page
    LINK_ONLINE,      // approved and configured
    LINK_REJECTED,    // the bridge doesn't accept this device's key
} link_status_t;

typedef struct {
    char name[65];
    bool has_avatar;  // false when the device has no bot attached
    char shape[16];
    uint32_t color;   // 0xRRGGBB
    int volume;       // 0..100
    bool muted;
    int max_listen_ms;
} link_config_t;

typedef struct {
    void (*status)(link_status_t status);
    void (*welcome)(const char *key);  // approved: store the key
    void (*forgotten)(void);           // the bridge forgot this device; the old key is gone
    void (*config)(const link_config_t *config);
    void (*show)(const char *state);
    void (*play_start)(const char *id, int sample_rate);
    void (*audio)(const uint8_t *pcm, size_t bytes);
    void (*play_end)(const char *id);
    void (*stop)(void);
    void (*forget_wifi)(void);
} link_handlers_t;

esp_err_t link_start(const char *url, const char *device_id, const char *firmware, const char *key,
                     const link_handlers_t *handlers);

void link_send_played(const char *id, bool stopped);
void link_send_stop(void);

// Listening: start, then 16 kHz microphone audio, then end (send it) or cancel (drop it).
// Each returns false when there is no link.
bool link_send_listen_start(void);
bool link_send_audio(const int16_t *pcm, size_t samples);
bool link_send_listen_end(bool cancel);
