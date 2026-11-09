// The setup page, served on the device's own setup network: a small web server plus a DNS responder
// that answers every name with the device's address, so a phone that joins opens the page by itself.
// The page asks for the home Wi-Fi and the bridge address, saves them and restarts the device.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "settings.h"

// `ip` is the setup network's address (network byte order); `saved` fills in the form.
esp_err_t portal_start(uint32_t ip, const settings_t *saved);
void portal_stop(void);

// Turns what the owner typed into a WebSocket URL: adds ws:// for an address with a port or an IP,
// wss:// otherwise, and the /device path. Returns false if nothing usable is left.
bool portal_bridge_url(const char *typed, char *out, size_t size);
