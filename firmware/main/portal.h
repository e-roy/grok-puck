// The setup page, served on the device's own setup network: a small web server plus a DNS responder
// that answers every name with the device's address, so a phone that joins opens the page by itself.
// The page lists nearby networks, adds a network (after joining it to check the password), forgets
// saved ones, and sets the bridge address. It reads and changes the Wi-Fi through net.c.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// `ip` is the setup network's address (network byte order).
esp_err_t portal_start(uint32_t ip);
void portal_stop(void);

// Turns what the owner typed into a WebSocket URL: adds ws:// for an address with a port or an IP,
// wss:// otherwise, and the /device path. Returns NULL, or why it can't (for the setup page): nothing
// usable is left, or a second address follows the first (a second "://", or a second scheme right
// after the first, as when "ws://" is left in the field and "wss://desk.example.com" typed after it).
const char *portal_bridge_url(const char *typed, char *out, size_t size);
