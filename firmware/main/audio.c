#include "audio.h"

#include <math.h>
#include <stdatomic.h>

#include "driver/i2s_std.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "audio";

// Speaker: PCM5101 on I2S0. Microphone: I2S1, right slot.
#define PIN_SPK_BCLK GPIO_NUM_48
#define PIN_SPK_WS GPIO_NUM_38
#define PIN_SPK_DOUT GPIO_NUM_47
#define PIN_MIC_SCK GPIO_NUM_15
#define PIN_MIC_WS GPIO_NUM_2
#define PIN_MIC_DIN GPIO_NUM_39

#define CHUNK 256  // samples converted per I2S call

static i2s_chan_handle_t speaker;
static i2s_chan_handle_t mic;
static atomic_int volume = 70;

static esp_err_t init_speaker(void) {
    i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan.auto_clear_after_cb = true;  // silence, not the last buffer, when nothing is playing
    ESP_ERROR_CHECK(i2s_new_channel(&chan, &speaker, NULL));
    i2s_std_config_t std = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(AUDIO_SPEAKER_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = PIN_SPK_BCLK,
            .ws = PIN_SPK_WS,
            .dout = PIN_SPK_DOUT,
            .din = I2S_GPIO_UNUSED,
        },
    };
    std.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(speaker, &std));
    return i2s_channel_enable(speaker);
}

static esp_err_t init_mic(void) {
    i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
    ESP_ERROR_CHECK(i2s_new_channel(&chan, NULL, &mic));
    i2s_std_config_t std = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(AUDIO_MIC_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = PIN_MIC_SCK,
            .ws = PIN_MIC_WS,
            .dout = I2S_GPIO_UNUSED,
            .din = PIN_MIC_DIN,
        },
    };
    std.slot_cfg.slot_mask = I2S_STD_SLOT_RIGHT;
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(mic, &std));
    return i2s_channel_enable(mic);
}

esp_err_t audio_init(void) {
    esp_err_t err = init_speaker();
    if (err == ESP_OK) err = init_mic();
    if (err != ESP_OK) ESP_LOGE(TAG, "audio init failed: %s", esp_err_to_name(err));
    return err;
}

void audio_set_volume(int percent) {
    atomic_store(&volume, percent < 0 ? 0 : percent > 100 ? 100 : percent);
}

esp_err_t audio_play(const int16_t *pcm, size_t samples) {
    int32_t out[CHUNK];
    // 16-bit sample into the top of a 32-bit slot, scaled by the volume.
    const int32_t gain = (65536 * atomic_load(&volume)) / 100;
    while (samples > 0) {
        const size_t n = samples < CHUNK ? samples : CHUNK;
        for (size_t i = 0; i < n; i++) out[i] = (int32_t)pcm[i] * gain;
        size_t written = 0;
        esp_err_t err = i2s_channel_write(speaker, out, n * sizeof(int32_t), &written, portMAX_DELAY);
        if (err != ESP_OK) return err;
        pcm += n;
        samples -= n;
    }
    return ESP_OK;
}

size_t audio_record(int16_t *pcm, size_t samples, uint32_t timeout_ms) {
    // The microphone's output carries a constant offset. A one-pole high-pass filter (about 20 Hz at
    // 16 kHz) removes it, so silence reads as silence. Only the audio task records, so the state can
    // be static.
    static float prev_in, prev_out;
    int32_t in[CHUNK];
    size_t total = 0;
    while (total < samples) {
        const size_t want = (samples - total) < CHUNK ? (samples - total) : CHUNK;
        size_t got = 0;
        if (i2s_channel_read(mic, in, want * sizeof(int32_t), &got, timeout_ms) != ESP_OK) break;
        got /= sizeof(int32_t);
        // The microphone's 24-bit sample sits high in the 32-bit slot; >> 12 keeps useful headroom.
        for (size_t i = 0; i < got; i++) {
            const float x = (float)(in[i] >> 12);
            const float y = x - prev_in + 0.992f * prev_out;
            prev_in = x;
            prev_out = y;
            pcm[total + i] = y > INT16_MAX ? INT16_MAX : y < -INT16_MAX ? -INT16_MAX : (int16_t)y;
        }
        total += got;
        if (got < want) break;
    }
    return total;
}

float audio_level(const int16_t *pcm, size_t samples) {
    if (samples == 0) return 0;
    double sum = 0;
    for (size_t i = 0; i < samples; i++) {
        const double v = pcm[i] / 32768.0;
        sum += v * v;
    }
    return (float)sqrt(sum / samples);
}

float audio_db(float rms) {
    return rms > 1e-5f ? 20 * log10f(rms) : -100;
}

float audio_meter(float rms) {
    const float m = (audio_db(rms) - AUDIO_METER_FLOOR_DB) / (AUDIO_METER_TOP_DB - AUDIO_METER_FLOOR_DB);
    return m < 0 ? 0 : m > 1 ? 1 : m;
}
