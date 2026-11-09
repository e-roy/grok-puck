// Speaker (PCM5101 DAC + amplifier) and microphone, each on its own I2S channel. All samples are
// 16-bit mono PCM: 24 kHz out (what the bridge sends), 16 kHz in (what it expects).
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define AUDIO_SPEAKER_RATE 24000
#define AUDIO_MIC_RATE 16000

esp_err_t audio_init(void);

// 0..100, applied in software (the board's trimmer still sets the analogue level).
void audio_set_volume(int percent);

// Blocks until the samples are queued for the speaker.
esp_err_t audio_play(const int16_t *pcm, size_t samples);

// Reads up to `samples` from the microphone; returns how many were read.
size_t audio_record(int16_t *pcm, size_t samples, uint32_t timeout_ms);

// Root-mean-square level of 16-bit samples, 0..1.
float audio_level(const int16_t *pcm, size_t samples);

// The RMS level in dB relative to full scale (-100 for silence).
float audio_db(float rms);

// A level for the face's ring, 0..1: AUDIO_METER_FLOOR_DB and below is 0, AUDIO_METER_TOP_DB is 1.
#define AUDIO_METER_FLOOR_DB -40.0f  // a quiet room measured -35 to -44 dB, a voice -15 to -23 dB
#define AUDIO_METER_TOP_DB -15.0f
float audio_meter(float rms);
