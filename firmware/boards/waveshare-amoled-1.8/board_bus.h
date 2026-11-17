// Shared between this board's board.c and audio.c: the I2C bus (touch, I/O expander, ES8311 codec,
// AXP2101, motion sensor, clock), started by board_init().
#pragma once

#include "driver/i2c_master.h"

i2c_master_bus_handle_t board_i2c_bus(void);
