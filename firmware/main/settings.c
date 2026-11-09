#include "settings.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "settings";
static const char *NS = "desk";

#define DEFAULT_COLOR 0xf59e0b
#define DEFAULT_VOLUME 70

esp_err_t settings_init(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "settings storage was full or from another version; starting fresh");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    return err;
}

static void get_str(nvs_handle_t h, const char *key, char *out, size_t size) {
    size_t len = size;
    if (nvs_get_str(h, key, out, &len) != ESP_OK) out[0] = '\0';
}

void settings_load(settings_t *out) {
    memset(out, 0, sizeof(*out));
    out->color = DEFAULT_COLOR;
    out->volume = DEFAULT_VOLUME;
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return;  // nothing saved yet
    get_str(h, "ssid", out->wifi_ssid, sizeof(out->wifi_ssid));
    get_str(h, "pass", out->wifi_pass, sizeof(out->wifi_pass));
    get_str(h, "bridge", out->bridge_url, sizeof(out->bridge_url));
    get_str(h, "key", out->device_key, sizeof(out->device_key));
    get_str(h, "last_err", out->last_error, sizeof(out->last_error));
    nvs_get_u8(h, "shape", &out->shape);
    nvs_get_u32(h, "color", &out->color);
    nvs_get_u8(h, "volume", &out->volume);
    uint8_t muted = 0;
    nvs_get_u8(h, "muted", &muted);
    out->muted = muted;
    nvs_close(h);
}

static esp_err_t set_str(nvs_handle_t h, const char *key, const char *value) {
    if (value[0] == '\0') {
        const esp_err_t err = nvs_erase_key(h, key);
        return err == ESP_ERR_NVS_NOT_FOUND ? ESP_OK : err;
    }
    return nvs_set_str(h, key, value);
}

esp_err_t settings_save_setup(const char *ssid, const char *pass, const char *bridge_url) {
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = set_str(h, "ssid", ssid);
    if (err == ESP_OK) err = set_str(h, "pass", pass);
    if (err == ESP_OK) err = set_str(h, "bridge", bridge_url);
    if (err == ESP_OK) err = set_str(h, "last_err", "");
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

esp_err_t settings_save_key(const char *key) {
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = set_str(h, "key", key);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

esp_err_t settings_save_look(uint8_t shape, uint32_t color, uint8_t volume, bool muted) {
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_u8(h, "shape", shape);
    if (err == ESP_OK) err = nvs_set_u32(h, "color", color);
    if (err == ESP_OK) err = nvs_set_u8(h, "volume", volume);
    if (err == ESP_OK) err = nvs_set_u8(h, "muted", muted ? 1 : 0);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

esp_err_t settings_save_error(const char *message) {
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = set_str(h, "last_err", message);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

esp_err_t settings_forget_wifi(void) {
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = set_str(h, "ssid", "");
    if (err == ESP_OK) err = set_str(h, "pass", "");
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}
