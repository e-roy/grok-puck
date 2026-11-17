// The Waveshare ESP32-S3-Touch-AMOLED-1.8 (board.h says what each value means). V1 and V2 share this
// build: board.c tells them apart at start-up.
#pragma once

#define BOARD_NAME "waveshare-amoled-1.8"

#define BOARD_LCD_WIDTH 368  // upright, 368 x 448
#define BOARD_LCD_HEIGHT 448

#define BOARD_HAS_TOUCH 1
#define BOARD_HAS_MICROPHONE 1
#define BOARD_HAS_SPEAKER 1
#define BOARD_OLED 1  // an AMOLED: the face drifts slowly, against burn-in
