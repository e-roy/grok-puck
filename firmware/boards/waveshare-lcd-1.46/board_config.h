// The Waveshare ESP32-S3-Touch-LCD-1.46 (board.h says what each value means).
#pragma once

#define BOARD_NAME "waveshare-lcd-1.46"

#define BOARD_LCD_SIZE 412  // round panel, 412 x 412
#define BOARD_LCD_WIDTH BOARD_LCD_SIZE
#define BOARD_LCD_HEIGHT BOARD_LCD_SIZE

#define BOARD_HAS_TOUCH 1
#define BOARD_HAS_MICROPHONE 1
#define BOARD_HAS_SPEAKER 1
#define BOARD_OLED 0  // an LCD: the face stays where it is
