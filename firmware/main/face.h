// The bot's face: its avatar body (shape and colour, as in the Grok Bot app) with two eyes, animated
// for each state. All functions except face_set_level() must be called with the LVGL lock held (or
// from LVGL callbacks).
#pragma once

#include <stdint.h>

#include "lvgl.h"

typedef enum {
    FACE_IDLE,
    FACE_LISTENING,  // while the owner holds the screen
    FACE_THINKING,
    FACE_WORKING,
    FACE_WAITING,  // the bot needs the owner's approval or an answer
    FACE_SPEAKING,
    FACE_ERROR,
    FACE_OFFLINE,
    FACE_STATE_COUNT,
} face_state_t;

typedef enum {
    FACE_BLOB,
    FACE_TEARDROP,
    FACE_CLOUD,
    FACE_HEX,
    FACE_SQUIRCLE,
    FACE_CIRCLE,
    FACE_SHAPE_COUNT,
} face_shape_t;

void face_create(lv_obj_t *screen);
void face_set_avatar(face_shape_t shape, uint32_t rgb);
void face_set_state(face_state_t state);
face_state_t face_get_state(void);  // safe from any task
// Microphone or speaker level, 0..1. Safe from any task.
void face_set_level(float level);

face_shape_t face_get_shape(void);
uint32_t face_get_color(void);

// A short reaction to a touch that does nothing else.
void face_poke(void);

// The setup screen: how to join the device's setup network (a QR code for a phone camera, and the
// name and password to type). It covers the face until face_hide_setup().
void face_show_setup(const char *ssid, const char *password);
void face_hide_setup(void);

// The face_shape_t for a shape name from the bridge ("blob", "hex", ...); FACE_SHAPE_COUNT if unknown.
face_shape_t face_shape_from_name(const char *name);

const char *face_state_name(face_state_t state);
const char *face_shape_name(face_shape_t shape);
