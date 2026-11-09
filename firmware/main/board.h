// The Waveshare ESP32-S3-Touch-LCD-1.46: pins, and bring-up of the display, touch and backlight.
#pragma once

#include <stdbool.h>

#include "esp_err.h"
#include "lvgl.h"

#define BOARD_LCD_SIZE 412  // round panel, 412 x 412

// Starts the display (QSPI, SPD2010), touch (I2C, SPD2010) and LVGL. After this, LVGL objects may be
// created while holding lvgl_port_lock().
esp_err_t board_init(void);

// 0..100
void board_set_backlight(int percent);

// True while the side BOOT button is held.
bool board_boot_pressed(void);
