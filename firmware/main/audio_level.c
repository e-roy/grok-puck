// Audio levels, the same on every board (audio.h). The speaker and microphone themselves are the
// board's: audio.c in its folder under boards/.
#include <math.h>

#include "audio.h"

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
