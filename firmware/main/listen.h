// Hold to talk. The microphone is recorded from the moment a finger touches the screen; once the
// touch counts as a hold, that audio and everything after it streams to the bridge until the finger
// lifts (or the longest message is reached). A tap records nothing that leaves the device.
#pragma once

#include <stdbool.h>

#include "esp_err.h"

typedef struct {
    void (*started)(void);         // listening began: stop speech, show listening
    void (*finished)(bool sent);  // sent: the bridge got a message; false: too little voice, or no link
} listen_handlers_t;

esp_err_t listen_init(const listen_handlers_t *handlers);

// From the touch callbacks; they only queue a command, so they never block the UI.
void listen_press(void);    // a finger touched the screen
void listen_hold(void);     // the touch became a hold: start sending
void listen_release(void);  // the finger lifted

void listen_set_max_ms(int ms);  // the longest message, from the bridge's config
