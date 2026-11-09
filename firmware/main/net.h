// Wi-Fi. The device joins its saved network. With none saved, or when the saved one can't be joined
// within a minute of starting, it opens its own setup network with a setup page (portal.c). While
// that is open it keeps trying the saved network, so a router that comes back after a power cut is
// joined again without anyone touching the device.
#pragma once

#include "esp_err.h"
#include "settings.h"

typedef enum {
    NET_JOINING,  // not on Wi-Fi (yet)
    NET_ONLINE,   // on Wi-Fi with an address
    NET_SETUP,    // the setup network is open
} net_state_t;

// `settings` must stay valid; `on_state` runs on the Wi-Fi task.
esp_err_t net_start(const settings_t *settings, void (*on_state)(net_state_t state));

const char *net_device_id(void);       // "desk-a1b2c3", from the Wi-Fi MAC address
const char *net_setup_ssid(void);      // "Desk-Setup-A1B2"
const char *net_setup_password(void);  // new for each setup session
