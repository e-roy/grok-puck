// What the device remembers across restarts, kept in NVS (flash): its Wi-Fi, the bridge, the key the
// bridge gave it, and the last look it was sent, so the right avatar shows before the bridge answers.
// Nothing here is ever logged.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

typedef struct {
    char wifi_ssid[33];
    char wifi_pass[65];
    char bridge_url[192];
    char device_key[129];
    char last_error[128];  // why joining Wi-Fi failed last time; shown on the setup page
    uint8_t shape;        // face_shape_t
    uint32_t color;       // 0xRRGGBB
    uint8_t volume;       // 0..100
    bool muted;
} settings_t;

esp_err_t settings_init(void);
void settings_load(settings_t *out);

esp_err_t settings_save_setup(const char *ssid, const char *pass, const char *bridge_url);
esp_err_t settings_save_key(const char *key);  // "" removes it
esp_err_t settings_save_look(uint8_t shape, uint32_t color, uint8_t volume, bool muted);
esp_err_t settings_save_error(const char *message);  // "" removes it
// Forgets the Wi-Fi network; the bridge address and key stay, so setup only needs the new network.
esp_err_t settings_forget_wifi(void);
