// What the device remembers across restarts, kept in NVS (flash): its Wi-Fi networks, the bridge, the
// key the bridge gave it, and the last look it was sent, so the right avatar shows before the bridge
// answers. Nothing here is ever logged.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#define SETTINGS_MAX_NETWORKS 5

typedef struct {
    char ssid[33];
    char pass[65];  // "" for an open network
} settings_network_t;

typedef struct {
    char bridge_url[192];
    char device_key[129];
    uint8_t shape;   // face_shape_t
    uint32_t color;  // 0xRRGGBB
    uint8_t volume;  // 0..100
    bool muted;
} settings_t;

// Opens the storage. The first start of firmware 0.6.0 moves the one network older firmware kept
// into the list, so the device stays on its Wi-Fi after the update.
esp_err_t settings_init(void);
void settings_load(settings_t *out);

esp_err_t settings_save_key(const char *key);  // "" removes it
esp_err_t settings_save_look(uint8_t shape, uint32_t color, uint8_t volume, bool muted);
// A new bridge address also removes the device key: a key belongs to one bridge. *changed says
// whether the address was different (nothing is written when it wasn't).
esp_err_t settings_save_bridge(const char *url, bool *changed);

// The saved Wi-Fi networks, most recently joined first. Safe from any task.
// Copies them (passwords included: wipe `out` after use) and returns how many there are.
int settings_networks(settings_network_t out[SETTINGS_MAX_NETWORKS]);
int settings_network_count(void);
// Adds a network at the top, or updates its password and moves it to the top.
// ESP_ERR_NO_MEM when SETTINGS_MAX_NETWORKS others are saved already.
esp_err_t settings_put_network(const char *ssid, const char *pass);
esp_err_t settings_network_to_top(const char *ssid);  // ESP_ERR_NOT_FOUND if it isn't saved
esp_err_t settings_forget_network(const char *ssid);  // ESP_ERR_NOT_FOUND if it isn't saved
// Forgets every network; the bridge address and key stay, so setup only needs a network.
esp_err_t settings_forget_networks(void);
