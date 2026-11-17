// Board bring-up. Pin assignments and the reset sequence follow Waveshare's documentation and examples
// for the ESP32-S3-Touch-LCD-1.46.
#include "board.h"

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"
#include "esp_io_expander_tca9554.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_spd2010.h"
#include "esp_lcd_touch_spd2010.h"
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

// Shared I2C bus: touch (0x53), TCA9554 expander (0x20), IMU, RTC.
#define PIN_I2C_SDA GPIO_NUM_11
#define PIN_I2C_SCL GPIO_NUM_10
// Display on QSPI.
#define LCD_HOST SPI2_HOST
#define PIN_LCD_SCK GPIO_NUM_40
#define PIN_LCD_D0 GPIO_NUM_46
#define PIN_LCD_D1 GPIO_NUM_45
#define PIN_LCD_D2 GPIO_NUM_42
#define PIN_LCD_D3 GPIO_NUM_41
#define PIN_LCD_CS GPIO_NUM_21
#define PIN_LCD_BL GPIO_NUM_5
#define PIN_TOUCH_INT GPIO_NUM_4
// Buttons and power.
#define PIN_BOOT GPIO_NUM_0
#define PIN_POWER_HOLD GPIO_NUM_7  // keeps the board on when it runs from a battery
// Expander pins: EXIO1 resets touch, EXIO2 resets the display.
#define EXIO_TOUCH_RST IO_EXPANDER_PIN_NUM_0
#define EXIO_LCD_RST IO_EXPANDER_PIN_NUM_1

#define LCD_PCLK_HZ (40 * 1000 * 1000)
#define LVGL_BUFFER_LINES 40

static i2c_master_bus_handle_t i2c_bus;

static esp_err_t init_power_and_buttons(void) {
    gpio_config_t hold = {.pin_bit_mask = 1ULL << PIN_POWER_HOLD, .mode = GPIO_MODE_OUTPUT};
    CHECK(gpio_config(&hold));
    gpio_set_level(PIN_POWER_HOLD, 1);
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

// Pulses the display and touch reset lines through the TCA9554 expander.
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
    const uint32_t pins = EXIO_TOUCH_RST | EXIO_LCD_RST;
    CHECK(esp_io_expander_set_dir(expander, pins, IO_EXPANDER_OUTPUT));
    CHECK(esp_io_expander_set_level(expander, pins, 1));
    vTaskDelay(pdMS_TO_TICKS(20));
    CHECK(esp_io_expander_set_level(expander, pins, 0));
    vTaskDelay(pdMS_TO_TICKS(100));
    CHECK(esp_io_expander_set_level(expander, pins, 1));
    vTaskDelay(pdMS_TO_TICKS(300));  // both chips need time before their first command
    return ESP_OK;
}

static esp_err_t init_backlight(void) {
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_13_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 5000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    CHECK(ledc_timer_config(&timer));
    ledc_channel_config_t channel = {
        .gpio_num = PIN_LCD_BL,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,  // dark until the first frame is drawn
    };
    return ledc_channel_config(&channel);
}

void board_set_backlight(int percent) {
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, (8191 * percent) / 100);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

bool board_boot_pressed(void) {
    return gpio_get_level(PIN_BOOT) == 0;
}

// Wraps the SPD2010 driver's read for two quirks:
// - While the controller starts its touch firmware it stops acknowledging in the middle of a command,
//   so the driver reports a failed I2C write, and esp_lvgl_port aborts on any touch read error. A
//   failed read counts as "no touch"; the next poll continues from the controller's new state.
// - In the middle of a press it sometimes reports no finger for a moment, which LVGL would take as a
//   release followed by a new tap. A touch only ends after TOUCH_RELEASE_MS without a finger; until
//   then the last point is repeated.
#define TOUCH_RELEASE_MS 200  // most gaps last 16-23 ms; one at the start of a hold lasted about 140 ms

static esp_err_t (*spd2010_read_data)(esp_lcd_touch_handle_t tp);

static esp_err_t touch_read_data(esp_lcd_touch_handle_t tp) {
    static int64_t next_warning_us;
    static int64_t last_touch_us = INT64_MIN / 2;
    static int64_t gap_since_us;  // when the finger went missing; 0 when not bridging a gap
    static esp_lcd_touch_point_data_t last_point;

    const esp_err_t err = spd2010_read_data(tp);
    const int64_t now = esp_timer_get_time();
    if (err != ESP_OK && now >= next_warning_us) {
        ESP_LOGW(TAG, "touch read failed (%s); polling continues", esp_err_to_name(err));
        next_warning_us = now + 10 * 1000 * 1000;
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

// The SPD2010 only accepts windows whose columns start on a multiple of 4 and end one before the next.
static void spd2010_rounder(lv_area_t *area) {
    area->x1 = area->x1 & ~3;
    area->x2 = (area->x2 & ~3) + 3;
}

esp_err_t board_init(void) {
    CHECK(init_power_and_buttons());
    CHECK(init_i2c());
    CHECK(reset_display_and_touch());
    CHECK(init_backlight());

    ESP_LOGI(TAG, "display: QSPI bus and SPD2010 panel");
    const spi_bus_config_t bus = SPD2010_PANEL_BUS_QSPI_CONFIG(PIN_LCD_SCK, PIN_LCD_D0, PIN_LCD_D1, PIN_LCD_D2, PIN_LCD_D3,
                                                               BOARD_LCD_SIZE * LVGL_BUFFER_LINES * sizeof(uint16_t));
    CHECK(spi_bus_initialize(LCD_HOST, &bus, SPI_DMA_CH_AUTO));
    esp_lcd_panel_io_spi_config_t io_cfg = SPD2010_PANEL_IO_QSPI_CONFIG(PIN_LCD_CS, NULL, NULL);
    io_cfg.pclk_hz = LCD_PCLK_HZ;
    esp_lcd_panel_io_handle_t lcd_io;
    CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &io_cfg, &lcd_io));
    spd2010_vendor_config_t vendor = {.flags.use_qspi_interface = 1};
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = GPIO_NUM_NC,  // reset through the expander, above
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor,
    };
    esp_lcd_panel_handle_t panel;
    CHECK(esp_lcd_new_panel_spd2010(lcd_io, &panel_cfg, &panel));
    CHECK(esp_lcd_panel_reset(panel));
    CHECK(esp_lcd_panel_init(panel));
    CHECK(esp_lcd_panel_disp_on_off(panel, true));

    ESP_LOGI(TAG, "touch: SPD2010 on I2C");
    esp_lcd_panel_io_i2c_config_t tp_io_cfg = ESP_LCD_TOUCH_IO_I2C_SPD2010_CONFIG();
    esp_lcd_panel_io_handle_t tp_io;
    CHECK(esp_lcd_new_panel_io_i2c(i2c_bus, &tp_io_cfg, &tp_io));
    // LVGL polls the touch controller instead of waiting for its interrupt. After a reset the SPD2010
    // pulls INT low once and waits for the host to read its status and send the start commands; that
    // edge comes before the interrupt handler exists, so in interrupt mode no read ever happens and
    // touch never starts.
    esp_lcd_touch_config_t tp_cfg = {
        .x_max = BOARD_LCD_SIZE,
        .y_max = BOARD_LCD_SIZE,
        .rst_gpio_num = GPIO_NUM_NC,  // reset through the expander, above
        .int_gpio_num = GPIO_NUM_NC,
    };
    esp_lcd_touch_handle_t touch;
    CHECK(esp_lcd_touch_new_i2c_spd2010(tp_io, &tp_cfg, &touch));
    spd2010_read_data = touch->read_data;
    touch->read_data = touch_read_data;

    ESP_LOGI(TAG, "LVGL");
    const lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    CHECK(lvgl_port_init(&port_cfg));
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = lcd_io,
        .panel_handle = panel,
        .buffer_size = BOARD_LCD_SIZE * LVGL_BUFFER_LINES,
        .double_buffer = true,
        .hres = BOARD_LCD_SIZE,
        .vres = BOARD_LCD_SIZE,
        .rounder_cb = spd2010_rounder,
        .color_format = LV_COLOR_FORMAT_RGB565,
        .flags = {.buff_dma = true, .swap_bytes = true},
    };
    lv_display_t *display = lvgl_port_add_disp(&disp_cfg);
    if (display == NULL) return ESP_FAIL;
    const lvgl_port_touch_cfg_t touch_cfg = {.disp = display, .handle = touch};
    if (lvgl_port_add_touch(&touch_cfg) == NULL) return ESP_FAIL;
    return ESP_OK;
}
