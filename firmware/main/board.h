// The board layer (spec §4.8): what the rest of the firmware asks of a board. Each board implements it
// in its own folder, boards/<id>/ (board.c, audio.c), and describes itself in its board_config.h: its
// id (BOARD_NAME), screen size (BOARD_LCD_WIDTH x BOARD_LCD_HEIGHT), what it has (BOARD_HAS_TOUCH,
// BOARD_HAS_MICROPHONE, BOARD_HAS_SPEAKER) and whether its screen is an OLED (BOARD_OLED). The build
// picks the folder (-D BOARD=<id>, firmware/README.md).
#pragma once

#include <stdbool.h>

#include "board_config.h"
#include "esp_err.h"
#include "lvgl.h"

// Starts the display, touch and LVGL. After this, LVGL objects may be created while holding
// lvgl_port_lock().
esp_err_t board_init(void);

// Screen brightness, 0..100: the backlight on an LCD, the panel's own brightness on an OLED.
void board_set_backlight(int percent);

// True while the side BOOT button is held.
bool board_boot_pressed(void);
