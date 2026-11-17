// Board bring-up for the Waveshare ESP32-S3-Touch-AMOLED-1.8. The pins, the reset sequence, the display's
// start-up commands and the way V1 (SH8601 + FT3168) and V2 (CO5300 + CST820) are told apart follow
// Waveshare's documentation and examples (its board support package 2.0.3 drives both displays with
// the CO5300 driver).
#include "board.h"

#include "board_bus.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/spi_master.h"
#include "esp_io_expander_tca9554.h"
#include "esp_lcd_co5300.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch_cst816s.h"
#include "esp_lcd_touch_ft5x06.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "board";

// Logs which call failed, then returns its error.
#define CHECK(call)                                                        \
    do {                                                                   \
        esp_err_t err_ = (call);                                           \
        if (err_ != ESP_OK) {                                              \
            ESP_LOGE(TAG, "%s failed: %s", #call, esp_err_to_name(err_));  \
            return err_;                                                   \
        }                                                                  \
    } while (0)

// Shared I2C bus: touch (0x38 on V1, 0x15 on V2), TCA9554 expander (0x20), ES8311 codec, AXP2101,
// motion sensor, clock.
#define PIN_I2C_SDA GPIO_NUM_15
#define PIN_I2C_SCL GPIO_NUM_14
#define I2C_HZ 400000
// Display on QSPI.
#define LCD_HOST SPI2_HOST
#define PIN_LCD_SCK GPIO_NUM_11
#define PIN_LCD_D0 GPIO_NUM_4
#define PIN_LCD_D1 GPIO_NUM_5
#define PIN_LCD_D2 GPIO_NUM_6
#define PIN_LCD_D3 GPIO_NUM_7
#define PIN_LCD_CS GPIO_NUM_12
#define PIN_BOOT GPIO_NUM_0
// Expander pins: EXIO0 resets the display, EXIO1 powers it, EXIO2 resets touch.
#define EXIO_LCD_RST IO_EXPANDER_PIN_NUM_0
#define EXIO_LCD_POWER IO_EXPANDER_PIN_NUM_1
#define EXIO_TOUCH_RST IO_EXPANDER_PIN_NUM_2

#define V2_X_GAP 16  // V2's picture starts 16 columns in
#define LVGL_BUFFER_LINES 40

static i2c_master_bus_handle_t i2c_bus;
static esp_lcd_panel_handle_t panel;

i2c_master_bus_handle_t board_i2c_bus(void) { return i2c_bus; }

static esp_err_t init_buttons(void) {
    gpio_config_t boot = {.pin_bit_mask = 1ULL << PIN_BOOT, .mode = GPIO_MODE_INPUT, .pull_up_en = GPIO_PULLUP_ENABLE};
    return gpio_config(&boot);
}

static esp_err_t init_i2c(void) {
    i2c_master_bus_config_t cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = PIN_I2C_SDA,
        .scl_io_num = PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    return i2c_new_master_bus(&cfg, &i2c_bus);
}

// Switches the display's power off and on and pulses the display and touch resets, through the TCA9554
// expander (Waveshare's sequence: 20 ms off, then 150 ms before the first command).
static esp_err_t reset_display_and_touch(void) {
    // A restart in the middle of a touch poll can leave the touch controller holding SDA low, and then
    // this first transaction fails. Clocking the bus frees it.
    esp_io_expander_handle_t expander = NULL;
    esp_err_t err = ESP_FAIL;
    for (int attempt = 0; attempt < 3 && err != ESP_OK; attempt++) {
        if (attempt > 0) {
            ESP_LOGW(TAG, "I2C bus busy at start; clearing it");
            i2c_master_bus_reset(i2c_bus);
            vTaskDelay(pdMS_TO_TICKS(10));
        }
        err = esp_io_expander_new_i2c_tca9554(i2c_bus, ESP_IO_EXPANDER_I2C_TCA9554_ADDRESS_000, &expander);
    }
    CHECK(err);
    const uint32_t pins = EXIO_LCD_RST | EXIO_LCD_POWER | EXIO_TOUCH_RST;
    CHECK(esp_io_expander_set_dir(expander, pins, IO_EXPANDER_OUTPUT));
    CHECK(esp_io_expander_set_level(expander, pins, 0));
    vTaskDelay(pdMS_TO_TICKS(20));
    CHECK(esp_io_expander_set_level(expander, pins, 1));
    vTaskDelay(pdMS_TO_TICKS(150));
    return ESP_OK;
}

// The AXP2101 power manager isn't touched: its power-on settings (DCDC1 and ALDO1 at 3.3 V, the other
// rails off) already power the chip, the display and the audio.

typedef enum { REVISION_UNKNOWN, REVISION_V1, REVISION_V2 } revision_t;

// V1's FT3168 answers at 0x38, V2's CST820 at 0x15 (as in Waveshare's examples).
static revision_t detect_revision(void) {
    for (int attempt = 0; attempt < 3; attempt++) {
        if (i2c_master_probe(i2c_bus, ESP_LCD_TOUCH_IO_I2C_CST816S_ADDRESS, 50) == ESP_OK) return REVISION_V2;
        if (i2c_master_probe(i2c_bus, ESP_LCD_TOUCH_IO_I2C_FT5x06_ADDRESS, 50) == ESP_OK) return REVISION_V1;
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    return REVISION_UNKNOWN;
}

// Waveshare's start-up commands, except: the brightness (0x51) starts at 0, so nothing shows until the
// first frame is drawn, and the colour format (0x3A) is left to the driver, which sends it for 16 bits.
static const co5300_lcd_init_cmd_t LCD_INIT[] = {
    {0xFE, (uint8_t[]){0x00}, 1, 0},
    {0xC4, (uint8_t[]){0x80}, 1, 0},
    {0x35, (uint8_t[]){0x00}, 1, 0},
    {0x53, (uint8_t[]){0x20}, 1, 0},
    {0x51, (uint8_t[]){0x00}, 1, 0},
    {0x63, (uint8_t[]){0xFF}, 1, 0},
    {0x2A, (uint8_t[]){0x00, 0x00, 0x01, 0x6F}, 4, 0},
    {0x2B, (uint8_t[]){0x00, 0x00, 0x01, 0xBF}, 4, 0},
    {0x11, NULL, 0, 100},
    {0x29, NULL, 0, 0},
};

void board_set_backlight(int percent) {
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    if (!panel) return;
    // The panel's own brightness command, on the display's bus: not while LVGL is sending a frame.
    lvgl_port_lock(0);
    esp_lcd_panel_co5300_set_brightness(panel, (uint8_t)percent);
    lvgl_port_unlock();
}

bool board_boot_pressed(void) {
    return gpio_get_level(PIN_BOOT) == 0;
}

// Wraps the touch driver's read for two things:
// - A failed read counts as "no touch" (esp_lvgl_port aborts on any touch read error). The CST820
//   stops answering on I2C while it sleeps between touches.
// - A finger that goes missing for a moment in the middle of a press would be a release followed by a
//   new tap for LVGL: a touch only ends after TOUCH_RELEASE_MS without a finger.
#define TOUCH_RELEASE_MS 120  // the CST820 has dropped the finger for 42 ms at the start of a hold

static esp_err_t (*driver_read_data)(esp_lcd_touch_handle_t tp);

static esp_err_t touch_read_data(esp_lcd_touch_handle_t tp) {
    static int64_t next_warning_us;
    static int64_t last_touch_us = INT64_MIN / 2;
    static int64_t gap_since_us;  // when the finger went missing; 0 when not bridging a gap
    static esp_lcd_touch_point_data_t last_point;

    const esp_err_t err = driver_read_data(tp);
    const int64_t now = esp_timer_get_time();
    if (err != ESP_OK) {
        portENTER_CRITICAL(&tp->data.lock);
        tp->data.points = 0;
        portEXIT_CRITICAL(&tp->data.lock);
        if (now >= next_warning_us && now - last_touch_us < 2 * 1000 * 1000) {
            // Only near a touch: while it sleeps, failed reads are normal.
            ESP_LOGW(TAG, "touch read failed (%s); polling continues", esp_err_to_name(err));
            next_warning_us = now + 10 * 1000 * 1000;
        }
    }

    portENTER_CRITICAL(&tp->data.lock);
    const bool touched = tp->data.points > 0;
    if (touched) {
        last_point = tp->data.coords[0];
    } else if (now - last_touch_us < TOUCH_RELEASE_MS * 1000) {
        tp->data.points = 1;
        tp->data.coords[0] = last_point;
    }
    portEXIT_CRITICAL(&tp->data.lock);

    if (touched) {
        if (gap_since_us) ESP_LOGI(TAG, "touch: bridged a %d ms gap", (int)((now - gap_since_us) / 1000));
        gap_since_us = 0;
        last_touch_us = now;
    } else if (now - last_touch_us < TOUCH_RELEASE_MS * 1000) {
        if (!gap_since_us) gap_since_us = now;
    } else {
        gap_since_us = 0;
    }
    return ESP_OK;
}

// The CO5300 and SH8601 only accept windows that start on an even column and row and end on an odd one.
static void even_rounder(lv_area_t *area) {
    area->x1 &= ~1;
    area->y1 &= ~1;
    area->x2 |= 1;
    area->y2 |= 1;
}

static esp_err_t init_touch(revision_t revision, esp_lcd_touch_handle_t *touch) {
    const esp_lcd_touch_config_t tp_cfg = {
        .x_max = BOARD_LCD_WIDTH,
        .y_max = BOARD_LCD_HEIGHT,
        .rst_gpio_num = GPIO_NUM_NC,  // reset through the expander, above
        .int_gpio_num = GPIO_NUM_NC,  // LVGL polls, as on the LCD-1.46
    };
    esp_lcd_panel_io_handle_t tp_io;
    if (revision == REVISION_V2) {
        esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_CST816S_CONFIG();
        io_cfg.scl_speed_hz = I2C_HZ;
        CHECK(esp_lcd_new_panel_io_i2c(i2c_bus, &io_cfg, &tp_io));
        CHECK(esp_lcd_touch_new_i2c_cst816s(tp_io, &tp_cfg, touch));
    } else {
        esp_lcd_panel_io_i2c_config_t io_cfg = ESP_LCD_TOUCH_IO_I2C_FT5x06_CONFIG();
        io_cfg.scl_speed_hz = I2C_HZ;
        CHECK(esp_lcd_new_panel_io_i2c(i2c_bus, &io_cfg, &tp_io));
        CHECK(esp_lcd_touch_new_i2c_ft5x06(tp_io, &tp_cfg, touch));
    }
    driver_read_data = (*touch)->read_data;
    (*touch)->read_data = touch_read_data;
    return ESP_OK;
}

esp_err_t board_init(void) {
    CHECK(init_buttons());
    CHECK(init_i2c());
    CHECK(reset_display_and_touch());
    const revision_t revision = detect_revision();
    if (revision == REVISION_UNKNOWN) {
        ESP_LOGE(TAG, "no touch controller answered (0x15 or 0x38): the face shows, but touch won't work");
    } else {
        ESP_LOGI(TAG, "AMOLED-1.8 %s", revision == REVISION_V2 ? "V2 (CO5300 + CST820)" : "V1 (SH8601 + FT3168)");
    }

    ESP_LOGI(TAG, "display: QSPI bus and AMOLED panel");
    const spi_bus_config_t bus = CO5300_PANEL_BUS_QSPI_CONFIG(PIN_LCD_SCK, PIN_LCD_D0, PIN_LCD_D1, PIN_LCD_D2, PIN_LCD_D3,
                                                              BOARD_LCD_WIDTH * LVGL_BUFFER_LINES * sizeof(uint16_t));
    CHECK(spi_bus_initialize(LCD_HOST, &bus, SPI_DMA_CH_AUTO));
    const esp_lcd_panel_io_spi_config_t io_cfg = CO5300_PANEL_IO_QSPI_CONFIG(PIN_LCD_CS, NULL, NULL);
    esp_lcd_panel_io_handle_t lcd_io;
    CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &io_cfg, &lcd_io));
    co5300_vendor_config_t vendor = {
        .init_cmds = LCD_INIT,
        .init_cmds_size = sizeof(LCD_INIT) / sizeof(LCD_INIT[0]),
        .flags.use_qspi_interface = 1,
    };
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = GPIO_NUM_NC,  // reset through the expander, above
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor,
    };
    CHECK(esp_lcd_new_panel_co5300(lcd_io, &panel_cfg, &panel));
    CHECK(esp_lcd_panel_reset(panel));
    CHECK(esp_lcd_panel_init(panel));
    CHECK(esp_lcd_panel_set_gap(panel, revision == REVISION_V1 ? 0 : V2_X_GAP, 0));
    CHECK(esp_lcd_panel_disp_on_off(panel, true));

    esp_lcd_touch_handle_t touch = NULL;
    if (revision != REVISION_UNKNOWN) {
        ESP_LOGI(TAG, "touch: %s on I2C", revision == REVISION_V2 ? "CST820" : "FT3168");
        if (init_touch(revision, &touch) != ESP_OK) touch = NULL;  // the face still shows
    }

    ESP_LOGI(TAG, "LVGL");
    const lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    CHECK(lvgl_port_init(&port_cfg));
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = lcd_io,
        .panel_handle = panel,
        .buffer_size = BOARD_LCD_WIDTH * LVGL_BUFFER_LINES,
        .double_buffer = true,
        .hres = BOARD_LCD_WIDTH,
        .vres = BOARD_LCD_HEIGHT,
        .rounder_cb = even_rounder,
        .color_format = LV_COLOR_FORMAT_RGB565,
        .flags = {.buff_dma = true, .swap_bytes = true},
    };
    lv_display_t *display = lvgl_port_add_disp(&disp_cfg);
    if (display == NULL) return ESP_FAIL;
    if (touch) {
        const lvgl_port_touch_cfg_t touch_cfg = {.disp = display, .handle = touch};
        if (lvgl_port_add_touch(&touch_cfg) == NULL) return ESP_FAIL;
    }
    return ESP_OK;
}
