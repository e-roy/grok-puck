// Wi-Fi. The device keeps up to 5 networks (settings.c): it scans, joins the saved one with the
// strongest signal and falls back to the next; the one it joins moves to the top. It opens its own
// setup network, with a setup page (portal.c), when no saved network is joined within a minute (of
// starting, or of losing Wi-Fi), when the bridge can't be reached for 2 minutes, or when the bridge
// asks for it (for 10 minutes, staying online). While that is open it keeps trying the saved networks
// every 30 s, unless a phone is on the setup network: a join can move the radio to another channel,
// and the setup network with it.
//
// Only this module's task touches the radio; the functions below may be called from any task.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "link.h"
#include "settings.h"

typedef struct {
    bool online;      // on Wi-Fi with an address
    bool setup_open;  // the setup network is open
} net_status_t;

typedef struct {
    void (*status)(const net_status_t *status);
    void (*wifi_changed)(void);    // something net_report() gives changed
    void (*bridge_changed)(void);  // the setup page saved a different bridge address
} net_handlers_t;

// The handlers run on the Wi-Fi task. `bridge_set`: a bridge address is saved.
esp_err_t net_start(bool bridge_set, const net_handlers_t *handlers);

const char *net_device_id(void);       // "desk-a1b2c3", from the Wi-Fi MAC address
const char *net_setup_ssid(void);      // "Desk-Setup-A1B2"
const char *net_setup_password(void);  // new each time the setup network opens

// ---- for the bridge link ----

void net_report(link_wifi_t *out);  // names only
// Whether the bridge answers (waiting for approval, approved, or refusing the key all count).
void net_bridge_link(bool up);
void net_open_setup(void);  // the admin page asks: open the setup network for 10 minutes
// Forgets a saved network, by its name as saved or as reported. If it is the one in use, the device
// leaves it and joins another. False when no saved network has that name.
bool net_forget_network(const char *ssid);

// ---- for the setup page ----

typedef struct {
    char ssid[33];
    int8_t rssi;
    uint8_t channel;
    bool open;   // no password
    bool saved;  // one of the saved networks
} net_nearby_t;
int net_nearby(net_nearby_t *out, int max);  // from the last scan, strongest first
void net_scan(int wait_ms);                  // a new scan; waits for it up to wait_ms

typedef enum { NET_SAVED_NOT_SEEN, NET_SAVED_NEARBY, NET_SAVED_IN_USE } net_saved_state_t;
typedef struct {
    char ssid[33];
    net_saved_state_t state;
    int rssi;           // with NEARBY and IN_USE
    char problem[64];   // why it couldn't be joined the last time it was tried, or ""
} net_saved_t;
int net_saved(net_saved_t out[SETTINGS_MAX_NETWORKS]);

typedef enum { NET_ADD_NONE, NET_ADD_CHECKING, NET_ADD_JOINED, NET_ADD_FAILED } net_add_state_t;
typedef struct {
    net_add_state_t state;
    char ssid[33];
    char problem[96];  // with NET_ADD_FAILED
} net_add_t;
// Joins the network to check its password, and saves it at the top if that works. Returns NULL when
// the check has started, or why it can't (a sentence for the page). The phone may lose the setup
// network meanwhile; net_add_result() keeps the outcome until the next Add.
const char *net_add(const char *ssid, const char *pass);
void net_add_result(net_add_t *out);

// Why the setup network is open: NET_WHY_* bits.
#define NET_WHY_NO_WIFI 1
#define NET_WHY_NO_BRIDGE 2
#define NET_WHY_ASKED 4
int net_setup_why(void);
// A setup page request: the setup network stays open at least 2 minutes after the last one.
void net_page_used(void);
// The setup page saved a different bridge address (settings_save_bridge).
void net_bridge_saved(void);
