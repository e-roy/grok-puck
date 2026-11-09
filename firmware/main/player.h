// Speech from the bridge. Its audio arrives over the link about a second ahead of real time and waits
// here (in PSRAM) until the audio task plays it. One clip at a time: the bridge sends the next one
// only after the device reports the last one played.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

esp_err_t player_init(void);

// From the link's task.
void player_begin(const char *id);  // a clip starts; whatever is left of an earlier one is dropped
void player_write(const uint8_t *pcm, size_t bytes);
void player_end(const char *id);  // no more audio for this clip

// From any task: drops the clip now. Returns false if nothing was playing.
bool player_stop(void);
bool player_busy(void);

// From the audio task: up to `samples` samples to play now. When it returns 0 and *finished is set,
// the clip with id `finished_id` has been played to its end.
size_t player_read(int16_t *pcm, size_t samples, bool *finished, char *finished_id, size_t id_size);
