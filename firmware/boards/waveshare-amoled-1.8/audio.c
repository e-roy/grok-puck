// Speaker and microphone of the Waveshare ESP32-S3-Touch-AMOLED-1.8: an ES8311 codec (set up with
// Espressif's esp_codec_dev) on one I2S port. Playing and recording share that port's clock, so both
// run at 24 kHz (what the bridge sends), and the microphone is resampled to 16 kHz here (what the bridge
// expects), with a 2:3 polyphase low-pass filter. Pins follow Waveshare's documentation and examples.
#include "audio.h"

#include <math.h>
#include <stdatomic.h>

#include "board_bus.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "audio";

#define PIN_MCLK GPIO_NUM_16
#define PIN_BCLK GPIO_NUM_9
#define PIN_WS GPIO_NUM_45
#define PIN_DOUT GPIO_NUM_8   // to the codec's DAC
#define PIN_DIN GPIO_NUM_10   // from the codec's ADC
#define PIN_AMP GPIO_NUM_46   // the speaker amplifier's enable

#define RATE AUDIO_SPEAKER_RATE  // both directions
// The codec's own output level (esp_codec_dev's 0..100 scale), under the admin page's volume, and the
// microphone amplifier's gain. Chosen on the board so that full volume is loud without distorting and
// a voice reads as on the LCD-1.46 (audio.h).
#define CODEC_VOLUME 85
// At 18 and 24 dB a voice at desk distance read -26 to -34 dB, too quiet to count as voice; at 36 dB
// it reads about -9 to -18 dB, with the quiet room at -45 to -52 dB.
#define MIC_GAIN_DB 36

#define CHUNK 256  // samples per I2S call

static i2s_chan_handle_t speaker;
static i2s_chan_handle_t mic;
static atomic_int volume = 70;

// ---- the microphone's 24 kHz to 16 kHz ----
//
// Up by 2 (zeros between the samples, 48 kHz), a low-pass filter, then every third sample: 2 samples
// out for every 3 in. Only the outputs are computed: each takes every other tap (a polyphase filter).
#define TAPS 64                   // at 48 kHz: 32 per output
#define CUTOFF_HZ 6600.0f         // speech; well below 8 kHz, the output's Nyquist
static float taps[TAPS];
static float history[TAPS / 2];   // the latest inputs, a ring
static int newest;                // in history
static int phase = 2;             // the next output's time (48 kHz steps) after the newest input's

static void make_taps(void) {
    const float fc = CUTOFF_HZ / (2 * RATE);  // in cycles per 48 kHz sample
    float sum = 0;
    for (int k = 0; k < TAPS; k++) {
        const float x = k - (TAPS - 1) / 2.0f;
        const float sinc = 2 * fc * (x == 0 ? 1 : sinf((float)(2 * M_PI) * fc * x) / ((float)(2 * M_PI) * fc * x));
        const float w = 0.42f - 0.5f * cosf((float)(2 * M_PI) * k / (TAPS - 1)) + 0.08f * cosf((float)(4 * M_PI) * k / (TAPS - 1));
        taps[k] = sinc * w;
        sum += taps[k];
    }
    for (int k = 0; k < TAPS; k++) taps[k] *= 2 / sum;  // gain 2 makes up for the zeros put in
}

// Takes one 24 kHz sample; returns how many 16 kHz samples it completes (0 or 1) in *out.
static int resample(float in, float *out) {
    newest = (newest + 1) % (TAPS / 2);
    history[newest] = in;
    phase -= 2;
    if (phase > 1) return 0;
    float y = 0;
    for (int m = 0, i = newest; m < TAPS / 2; m++, i = (i ? i : TAPS / 2) - 1) y += taps[phase + 2 * m] * history[i];
    phase += 3;
    *out = y;
    return 1;
}

// ---- set-up ----

static esp_err_t init_codec(void) {
    i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan.auto_clear_after_cb = true;  // silence, not the last buffer, when nothing is playing
    ESP_ERROR_CHECK(i2s_new_channel(&chan, &speaker, &mic));
    i2s_std_config_t std = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(RATE),  // MCLK at 256 x the rate, as the codec expects
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {.mclk = PIN_MCLK, .bclk = PIN_BCLK, .ws = PIN_WS, .dout = PIN_DOUT, .din = PIN_DIN},
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(speaker, &std));
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(mic, &std));
    // Running already, so that esp_codec_dev can stop them to set them up (it logs errors otherwise).
    ESP_ERROR_CHECK(i2s_channel_enable(speaker));
    ESP_ERROR_CHECK(i2s_channel_enable(mic));

    audio_codec_i2s_cfg_t i2s_cfg = {.port = I2S_NUM_0, .tx_handle = speaker, .rx_handle = mic};
    const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&i2s_cfg);
    audio_codec_i2c_cfg_t i2c_cfg = {.port = I2C_NUM_0, .addr = ES8311_CODEC_DEFAULT_ADDR, .bus_handle = board_i2c_bus()};
    const audio_codec_ctrl_if_t *ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
    const audio_codec_gpio_if_t *gpio_if = audio_codec_new_gpio();
    if (!data_if || !ctrl_if || !gpio_if) return ESP_ERR_NO_MEM;
    es8311_codec_cfg_t es8311 = {
        .ctrl_if = ctrl_if,
        .gpio_if = gpio_if,
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_BOTH,
        .pa_pin = PIN_AMP,
        .use_mclk = true,
        .no_dac_ref = true,  // nothing of the speaker's own output in the recording
        .hw_gain = {.pa_voltage = 5.0, .codec_dac_voltage = 3.3},
    };
    const audio_codec_if_t *codec_if = es8311_codec_new(&es8311);
    if (!codec_if) return ESP_FAIL;
    esp_codec_dev_cfg_t dev_cfg = {.dev_type = ESP_CODEC_DEV_TYPE_IN_OUT, .codec_if = codec_if, .data_if = data_if};
    esp_codec_dev_handle_t codec = esp_codec_dev_new(&dev_cfg);
    if (!codec) return ESP_FAIL;
    esp_codec_dev_sample_info_t fs = {
        .bits_per_sample = 16,
        .channel = 1,
        .channel_mask = ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0),  // the left slot, both ways
        .sample_rate = RATE,
        .mclk_multiple = 256,
    };
    if (esp_codec_dev_open(codec, &fs) != ESP_CODEC_DEV_OK) return ESP_FAIL;
    if (esp_codec_dev_set_out_vol(codec, CODEC_VOLUME) != ESP_CODEC_DEV_OK) return ESP_FAIL;
    if (esp_codec_dev_set_in_gain(codec, MIC_GAIN_DB) != ESP_CODEC_DEV_OK) return ESP_FAIL;
    // esp_codec_dev has enabled both I2S channels; samples go straight to them from here on.
    return ESP_OK;
}

esp_err_t audio_init(void) {
    make_taps();
    const esp_err_t err = init_codec();
    if (err != ESP_OK) ESP_LOGE(TAG, "audio init failed: %s", esp_err_to_name(err));
    return err;
}

void audio_set_volume(int percent) {
    atomic_store(&volume, percent < 0 ? 0 : percent > 100 ? 100 : percent);
}

esp_err_t audio_play(const int16_t *pcm, size_t samples) {
    int16_t out[CHUNK];
    // Scaled by the volume as on the LCD-1.46: the sample times percent / 100.
    const int32_t gain = (65536 * atomic_load(&volume)) / 100;
    while (samples > 0) {
        const size_t n = samples < CHUNK ? samples : CHUNK;
        for (size_t i = 0; i < n; i++) out[i] = (int16_t)(((int32_t)pcm[i] * gain) >> 16);
        size_t written = 0;
        esp_err_t err = i2s_channel_write(speaker, out, n * sizeof(int16_t), &written, portMAX_DELAY);
        if (err != ESP_OK) return err;
        pcm += n;
        samples -= n;
    }
    return ESP_OK;
}

size_t audio_record(int16_t *pcm, size_t samples, uint32_t timeout_ms) {
    // The one-pole high-pass filter of the LCD-1.46 (about 20 Hz at 16 kHz), after resampling, so a
    // constant offset reads as silence. Only the audio task records, so the state can be static.
    static float prev_in, prev_out;
    static int16_t carry;  // an output the last call had no room for
    static bool has_carry;
    int16_t in[CHUNK];
    size_t total = 0;
    if (has_carry && samples > 0) {
        pcm[total++] = carry;
        has_carry = false;
    }
    while (total < samples) {
        size_t want = ((samples - total) * 3 + 1) / 2;  // about 3 in for every 2 out
        if (want > CHUNK) want = CHUNK;
        size_t got = 0;
        if (i2s_channel_read(mic, in, want * sizeof(int16_t), &got, timeout_ms) != ESP_OK && got == 0) break;
        got /= sizeof(int16_t);
        for (size_t i = 0; i < got; i++) {
            float x;
            if (!resample(in[i], &x)) continue;
            const float y = x - prev_in + 0.992f * prev_out;
            prev_in = x;
            prev_out = y;
            const int16_t s = y > INT16_MAX ? INT16_MAX : y < -INT16_MAX ? -INT16_MAX : (int16_t)y;
            if (total < samples) {
                pcm[total++] = s;
            } else {
                carry = s;
                has_carry = true;
            }
        }
        if (got < want) break;
    }
    return total;
}
