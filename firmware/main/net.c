#include "net.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_check.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "portal.h"

static const char *TAG = "net";

// The setup network opens when (A) no saved network is joined this long after starting or after
// losing Wi-Fi, (B) on Wi-Fi the bridge isn't reached this long, or (C) the bridge asks for it.
#define SETUP_AFTER_MS (60 * 1000)
#define NO_BRIDGE_MS (2 * 60 * 1000)
#define ASKED_MS (10 * 60 * 1000)
#define LINGER_MS (2 * 60 * 1000)      // it stays open this long after its page was last used
#define RETRY_IN_SETUP_MS (30 * 1000)  // how often the saved networks are tried while it is open
#define RETRY_MAX_MS (15 * 1000)       // otherwise: 1, 2, 4, 8, 15, 15 ... s between rounds
#define ATTEMPT_MS (20 * 1000)         // one network, from connecting to having an address
#define LEAVE_MS 3000                  // a disconnect that doesn't report back is taken as done
#define SCAN_MS 10000
#define ADD_DELAY_MS 1500              // so the page's answer reaches the phone before the radio moves
#define SIGNAL_EVERY_MS (60 * 1000)
#define SIGNAL_STEP 5                  // dB: smaller changes aren't reported to the bridge
#define MAX_SCAN 20
#define MAX_NEARBY 16
#define TICK_MS 1000
#define REASON_TIMEOUT 0               // not a driver reason: no address in time

// Easy to read and type: no 0/o, 1/l/i.
static const char PASSWORD_LETTERS[] = "abcdefghjkmnpqrstuvwxyz23456789";

typedef enum {
    CMD_STA_START,
    CMD_SCAN_DONE,
    CMD_DISCONNECTED,  // value: the reason
    CMD_GOT_IP,
    CMD_LINK,          // value: 1 up, 0 down
    CMD_OPEN_SETUP,
    CMD_SCAN,
    CMD_ADD,
    CMD_FORGOT,        // ssid: already removed from the settings
    CMD_BRIDGE,
} command_t;

typedef struct {
    command_t type;
    int value;
    char ssid[33];
} cmd_t;

// What the station is doing, and what follows once a disconnect is done.
typedef enum { RADIO_IDLE, RADIO_SCANNING, RADIO_CONNECTING, RADIO_LEAVING } radio_t;
typedef enum { THEN_NOTHING, THEN_FAILED, THEN_ADD, THEN_ROUND } then_t;

typedef struct {
    char ssid[33];
    uint8_t channel;  // from the scan; 0 when it wasn't seen
} candidate_t;

static QueueHandle_t commands;
static SemaphoreHandle_t lock;  // guards the "shared" state below
static EventGroupHandle_t events;
#define SCANNED_BIT BIT0
static net_handlers_t on;
static esp_netif_t *ap_netif;
static char device_id[16];
static char setup_ssid[20];
static char setup_password[12];
static char captive_uri[32];
static wifi_ap_record_t *records;  // scan results, in PSRAM

// The Wi-Fi task's own state.
static bool sta_started;
static bool online;
static bool link_up;
static bool bridge_set;
static bool setup_open;
static radio_t radio = RADIO_IDLE;
static then_t then = THEN_NOTHING;
static int leave_reason;
static int64_t deadline_ms;  // for the radio's current step
static int64_t offline_since_ms;
static int64_t link_down_since_ms;
static int64_t asked_until_ms;
static int64_t next_round_ms;
static int64_t next_signal_ms;
static int retry_ms = 1000;
static bool scan_wanted;     // the setup page asked for one
static bool scan_for_round;
static bool force_round;     // after a failed Add on a device that was online: rejoin at once
static candidate_t candidates[SETTINGS_MAX_NETWORKS];
static int candidate_count, candidate_next;
static char trying[33];      // the network being joined
static bool trying_add;
static bool add_was_online;

// Shared with the setup page and the link (lock held).
static net_nearby_t nearby[MAX_NEARBY];
static int nearby_count;
static char current[33];  // "" when not on Wi-Fi
static int report_rssi;
static struct {
    char ssid[33];
    int reason;
} failures[SETTINGS_MAX_NETWORKS];  // the last failed try of each network
static net_add_t add;
static char add_pass[65];
static bool add_pending;  // waiting to start
static int64_t add_at_ms;
static int64_t linger_until_ms;
static int why;

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void post(command_t type, int value) {
    const cmd_t c = {.type = type, .value = value};
    xQueueSend(commands, &c, pdMS_TO_TICKS(100));
}

// Copies a Wi-Fi name (at most 32 bytes) into a 33-byte buffer.
static void copy_name(char *out, const char *ssid) {
    const size_t n = strnlen(ssid, 32);
    memcpy(out, ssid, n);
    out[n] = 0;
}

static const char *reason_text(int reason) {
    switch (reason) {
        case REASON_TIMEOUT:
            return "it gave no address in time";
        case WIFI_REASON_NO_AP_FOUND:
        case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:
            return "the network was not found";
        case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
        case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
            return "the network uses a kind of security this device doesn't support";
        case WIFI_REASON_AUTH_FAIL:
        case WIFI_REASON_AUTH_EXPIRE:
        case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
        case WIFI_REASON_HANDSHAKE_TIMEOUT:
            return "the password was not accepted";
        default:
            return "the connection failed";
    }
}

static const char *why_text(int reasons) {
    if (reasons & NET_WHY_ASKED) return "asked from the admin page";
    if (reasons & NET_WHY_NO_WIFI) return "no saved network joined";
    if (reasons & NET_WHY_NO_BRIDGE) return "the bridge can't be reached";
    return "";
}

// Wi-Fi names are bytes; the bridge needs valid UTF-8 (a WebSocket closes on anything else), so each
// byte that isn't part of a valid sequence becomes '?'.
static void clean_name(const char *in, char *out, size_t size) {
    const unsigned char *s = (const unsigned char *)in;
    size_t o = 0;
    while (*s && o + 1 < size) {
        int len = 0;
        unsigned char lo = 0x80, hi = 0xbf;  // the allowed range of the second byte
        if (s[0] < 0x80) {
            len = 1;
        } else if (s[0] >= 0xc2 && s[0] <= 0xdf) {
            len = 2;
        } else if (s[0] >= 0xe0 && s[0] <= 0xef) {
            len = 3;
            if (s[0] == 0xe0) lo = 0xa0;
            if (s[0] == 0xed) hi = 0x9f;  // no surrogates
        } else if (s[0] >= 0xf0 && s[0] <= 0xf4) {
            len = 4;
            if (s[0] == 0xf0) lo = 0x90;
            if (s[0] == 0xf4) hi = 0x8f;
        }
        bool ok = len > 0;
        for (int i = 1; ok && i < len; i++) ok = i == 1 ? s[i] >= lo && s[i] <= hi : (s[i] & 0xc0) == 0x80;
        if (!ok) {
            out[o++] = '?';
            s++;
            continue;
        }
        if (o + len >= size) break;
        memcpy(out + o, s, len);
        o += len;
        s += len;
    }
    out[o] = '\0';
}

static bool phone_on_setup_network(void) {
    wifi_sta_list_t list;
    return setup_open && esp_wifi_ap_get_sta_list(&list) == ESP_OK && list.num > 0;
}

// Position (1-based) of a network in the saved list, for logs that don't name it; 0 if not saved.
static int saved_position(const char *ssid) {
    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int n = settings_networks(saved);
    int at = 0;
    for (int i = 0; i < n && !at; i++) {
        if (strcmp(saved[i].ssid, ssid) == 0) at = i + 1;
    }
    memset(saved, 0, sizeof(saved));
    return at;
}

// Remembers why a network couldn't be joined, for the setup page; a negative reason clears it.
static void set_failure(const char *ssid, int reason) {
    xSemaphoreTake(lock, portMAX_DELAY);
    int slot = -1, empty = -1;
    for (int i = 0; i < SETTINGS_MAX_NETWORKS; i++) {
        if (strcmp(failures[i].ssid, ssid) == 0) {
            slot = i;
        } else if (!failures[i].ssid[0] && empty < 0) {
            empty = i;
        }
    }
    if (reason < 0) {
        if (slot >= 0) memset(&failures[slot], 0, sizeof(failures[slot]));
    } else {
        if (slot < 0) slot = empty >= 0 ? empty : 0;
        copy_name(failures[slot].ssid, ssid);
        failures[slot].reason = reason;
    }
    xSemaphoreGive(lock);
}

static void report_status(void) {
    const net_status_t status = {.online = online, .setup_open = setup_open};
    on.status(&status);
}

static void wifi_changed(void) {
    int rssi = 0;
    if (online) esp_wifi_sta_get_rssi(&rssi);
    xSemaphoreTake(lock, portMAX_DELAY);
    report_rssi = rssi;
    xSemaphoreGive(lock);
    on.wifi_changed();
}

// ---- the setup network ----

static void enter_setup(int reasons) {
    for (int i = 0; i < 8; i++) setup_password[i] = PASSWORD_LETTERS[esp_random() % (sizeof(PASSWORD_LETTERS) - 1)];
    setup_password[8] = '\0';

    wifi_config_t ap = {0};
    memcpy(ap.ap.ssid, setup_ssid, strlen(setup_ssid));
    ap.ap.ssid_len = strlen(setup_ssid);
    memcpy(ap.ap.password, setup_password, strlen(setup_password));
    ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
    ap.ap.max_connection = 2;
    ap.ap.channel = 1;
    wifi_ap_record_t joined;
    if (online && esp_wifi_sta_get_ap_info(&joined) == ESP_OK) ap.ap.channel = joined.primary;  // it would follow anyway
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));

    // DHCP option 114 tells phones where the setup page is, so they open it by themselves.
    esp_netif_ip_info_t ip;
    esp_netif_get_ip_info(ap_netif, &ip);
    snprintf(captive_uri, sizeof(captive_uri), "http://" IPSTR "/", IP2STR(&ip.ip));
    esp_netif_dhcps_stop(ap_netif);
    esp_netif_dhcps_option(ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI, captive_uri, strlen(captive_uri));
    esp_netif_dhcps_start(ap_netif);

    portal_start(ip.ip.addr);
    setup_open = true;
    scan_wanted = true;  // fresh nearby networks for the page
    ESP_LOGI(TAG, "setup network %s is open: %s", setup_ssid, why_text(reasons));
    report_status();
    wifi_changed();
}

static void leave_setup(void) {
    portal_stop();
    esp_wifi_set_mode(WIFI_MODE_STA);
    setup_open = false;
    xSemaphoreTake(lock, portMAX_DELAY);
    if (add.state != NET_ADD_CHECKING) memset(&add, 0, sizeof(add));  // the next setup starts afresh
    xSemaphoreGive(lock);
    ESP_LOGI(TAG, "setup network closed");
    report_status();
    wifi_changed();
}

static void check_setup(int64_t now) {
    const int saved = settings_network_count();
    int reasons = 0;
    if (!online && (saved == 0 || now - offline_since_ms >= SETUP_AFTER_MS)) reasons |= NET_WHY_NO_WIFI;
    if (online && !link_up && (!bridge_set || now - link_down_since_ms >= NO_BRIDGE_MS)) reasons |= NET_WHY_NO_BRIDGE;
    if (now < asked_until_ms) reasons |= NET_WHY_ASKED;
    xSemaphoreTake(lock, portMAX_DELAY);
    why = setup_open ? reasons : 0;
    const bool busy = add_pending || trying_add;
    const int64_t linger = linger_until_ms;
    xSemaphoreGive(lock);
    if (radio != RADIO_IDLE || busy) return;  // the radio first finishes what it is doing
    if (reasons && !setup_open) {
        enter_setup(reasons);
        xSemaphoreTake(lock, portMAX_DELAY);
        why = reasons;
        xSemaphoreGive(lock);
    } else if (!reasons && setup_open && now >= linger) {
        leave_setup();
    }
}

// ---- joining ----

static bool start_scan(bool for_round) {
    const wifi_scan_config_t cfg = {.show_hidden = false};
    const esp_err_t err = esp_wifi_scan_start(&cfg, false);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "network scan failed: %s", esp_err_to_name(err));
        xEventGroupSetBits(events, SCANNED_BIT);  // nobody waits for a scan that never comes
        return false;
    }
    radio = RADIO_SCANNING;
    deadline_ms = now_ms() + SCAN_MS;
    scan_for_round = for_round;
    return true;
}

static void round_failed(void) {
    candidate_count = 0;
    if (setup_open) {
        next_round_ms = now_ms() + RETRY_IN_SETUP_MS;
    } else {
        next_round_ms = now_ms() + retry_ms;
        retry_ms = retry_ms * 2 > RETRY_MAX_MS ? RETRY_MAX_MS : retry_ms * 2;
    }
}

// Joins `ssid` with `pass`, or with its saved password when `pass` is NULL.
static bool connect_to(const char *ssid, const char *pass, uint8_t channel) {
    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int n = settings_networks(saved);
    if (!pass) {
        for (int i = 0; i < n && !pass; i++) {
            if (strcmp(saved[i].ssid, ssid) == 0) pass = saved[i].pass;
        }
    }
    esp_err_t err = ESP_ERR_NOT_FOUND;  // forgotten meanwhile
    if (pass) {
        wifi_config_t cfg = {0};
        memcpy(cfg.sta.ssid, ssid, strnlen(ssid, sizeof(cfg.sta.ssid)));
        memcpy(cfg.sta.password, pass, strnlen(pass, sizeof(cfg.sta.password)));
        cfg.sta.channel = channel;                        // a hint: scanning starts there
        cfg.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;      // so the strongest access point is chosen
        cfg.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
        cfg.sta.pmf_cfg.capable = true;
        err = esp_wifi_set_config(WIFI_IF_STA, &cfg);
        if (err == ESP_OK) err = esp_wifi_connect();
        memset(&cfg, 0, sizeof(cfg));
    }
    memset(saved, 0, sizeof(saved));
    if (err != ESP_OK) {
        if (err != ESP_ERR_NOT_FOUND) ESP_LOGW(TAG, "couldn't start joining: %s", esp_err_to_name(err));
        return false;
    }
    copy_name(trying, ssid);
    radio = RADIO_CONNECTING;
    deadline_ms = now_ms() + ATTEMPT_MS;
    return true;
}

static void try_next(void) {
    trying_add = false;
    while (candidate_next < candidate_count) {
        const candidate_t *c = &candidates[candidate_next++];
        if (connect_to(c->ssid, NULL, c->channel)) {
            ESP_LOGI(TAG, "joining saved network %d (%s)", saved_position(c->ssid), c->channel ? "in reach" : "not seen in the scan");
            return;
        }
    }
    round_failed();
}

// The saved networks the scan found, strongest first, then the others (hidden networks don't show
// in a scan, but can still be joined by name).
static void start_round(const wifi_ap_record_t *found, int n) {
    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int count = settings_networks(saved);
    bool added[SETTINGS_MAX_NETWORKS] = {0};
    candidate_count = 0;
    for (int r = 0; r < n; r++) {  // `found` is sorted by signal
        for (int i = 0; i < count; i++) {
            if (added[i] || strcmp((const char *)found[r].ssid, saved[i].ssid) != 0) continue;
            added[i] = true;
            copy_name(candidates[candidate_count].ssid, saved[i].ssid);
            candidates[candidate_count++].channel = found[r].primary;
        }
    }
    for (int i = 0; i < count; i++) {
        if (added[i]) continue;
        copy_name(candidates[candidate_count].ssid, saved[i].ssid);
        candidates[candidate_count++].channel = 0;
    }
    memset(saved, 0, sizeof(saved));
    candidate_next = 0;
    try_next();
}

static int by_signal(const void *a, const void *b) {
    return ((const wifi_ap_record_t *)b)->rssi - ((const wifi_ap_record_t *)a)->rssi;
}

static void scan_done(void) {
    uint16_t n = MAX_SCAN;
    if (esp_wifi_scan_get_ap_records(&n, records) != ESP_OK) n = 0;  // also frees the driver's list
    if (radio == RADIO_SCANNING) radio = RADIO_IDLE;
    qsort(records, n, sizeof(records[0]), by_signal);

    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int count = settings_networks(saved);
    xSemaphoreTake(lock, portMAX_DELAY);
    nearby_count = 0;
    for (int r = 0; r < n && nearby_count < MAX_NEARBY; r++) {
        const char *ssid = (const char *)records[r].ssid;
        bool skip = ssid[0] == '\0';  // hidden; and one network with several access points shows once
        for (int j = 0; j < nearby_count && !skip; j++) skip = strcmp(nearby[j].ssid, ssid) == 0;
        if (skip) continue;
        net_nearby_t *e = &nearby[nearby_count++];
        copy_name(e->ssid, ssid);
        e->rssi = records[r].rssi;
        e->channel = records[r].primary;
        e->open = records[r].authmode == WIFI_AUTH_OPEN;
        e->saved = false;
        for (int i = 0; i < count; i++) e->saved |= strcmp(saved[i].ssid, ssid) == 0;
    }
    const bool adding = add_pending;
    xSemaphoreGive(lock);
    memset(saved, 0, sizeof(saved));
    scan_wanted = false;
    xEventGroupSetBits(events, SCANNED_BIT);

    if (scan_for_round) {
        scan_for_round = false;
        if (!online && !adding) {
            start_round(records, n);
        } else {
            round_failed();
        }
    }
}

static void after_leave(void);

// Disconnects the station, then does `next`.
static void leave(then_t next, int reason) {
    then = next;
    leave_reason = reason;
    if (esp_wifi_disconnect() == ESP_OK) {
        radio = RADIO_LEAVING;
        deadline_ms = now_ms() + LEAVE_MS;
    } else {
        radio = RADIO_IDLE;
        after_leave();
    }
}

static void add_finished(bool joined, const char *problem) {
    trying_add = false;
    const int64_t now = now_ms();
    xSemaphoreTake(lock, portMAX_DELAY);
    add.state = joined ? NET_ADD_JOINED : NET_ADD_FAILED;
    snprintf(add.problem, sizeof(add.problem), "%s", joined ? "" : problem);
    memset(add_pass, 0, sizeof(add_pass));
    linger_until_ms = now + LINGER_MS;  // time for the phone to come back and see this
    xSemaphoreGive(lock);
    if (joined) {
        ESP_LOGI(TAG, "the new network joined and saved");
        return;
    }
    ESP_LOGW(TAG, "the new network was not saved: %s", problem);
    if (add_was_online) {
        force_round = true;  // back to the network it was on, even with the phone there
        next_round_ms = now;
    } else {
        round_failed();
    }
}

static void start_add(void) {
    xSemaphoreTake(lock, portMAX_DELAY);
    uint8_t channel = 0;
    for (int i = 0; i < nearby_count; i++) {
        if (strcmp(nearby[i].ssid, add.ssid) == 0) channel = nearby[i].channel;
    }
    char ssid[33], pass[65];
    copy_name(ssid, add.ssid);
    snprintf(pass, sizeof(pass), "%s", add_pass);
    xSemaphoreGive(lock);
    ESP_LOGI(TAG, "checking a new network");
    const bool started = connect_to(ssid, pass, channel);
    memset(pass, 0, sizeof(pass));
    if (started) {
        trying_add = true;
    } else {
        add_finished(false, "the connection failed");
    }
}

static void attempt_failed(int reason) {
    if (trying_add) {
        ESP_LOGW(TAG, "couldn't join the new network: %s (reason %d)", reason_text(reason), reason);
        add_finished(false, reason_text(reason));
        return;
    }
    ESP_LOGW(TAG, "couldn't join saved network %d: %s (reason %d)", saved_position(trying), reason_text(reason), reason);
    set_failure(trying, reason);
    try_next();
}

static void after_leave(void) {
    const then_t next = then;
    then = THEN_NOTHING;
    switch (next) {
        case THEN_FAILED:
            attempt_failed(leave_reason);
            break;
        case THEN_ADD:
            start_add();
            break;
        case THEN_ROUND:
            retry_ms = 1000;
            next_round_ms = now_ms();
            break;
        case THEN_NOTHING:
            break;
    }
}

static void disconnected(int reason) {
    const bool was_online = online;
    if (online) {
        online = false;
        offline_since_ms = now_ms();
        xSemaphoreTake(lock, portMAX_DELAY);
        current[0] = '\0';
        xSemaphoreGive(lock);
    }
    if (radio == RADIO_LEAVING) {
        radio = RADIO_IDLE;
        after_leave();
    } else if (radio == RADIO_CONNECTING) {
        radio = RADIO_IDLE;
        attempt_failed(reason);
    } else if (was_online) {
        ESP_LOGW(TAG, "Wi-Fi lost (reason %d)", reason);
        retry_ms = 1000;
        next_round_ms = now_ms();
    }
    if (was_online) {
        report_status();
        wifi_changed();
    }
}

static void got_ip(void) {
    if (online) return;  // a renewed address
    online = true;
    radio = RADIO_IDLE;
    retry_ms = 1000;
    candidate_count = 0;
    link_down_since_ms = now_ms();
    next_signal_ms = now_ms() + SIGNAL_EVERY_MS;
    xSemaphoreTake(lock, portMAX_DELAY);
    copy_name(current, trying);
    char ssid[33], pass[65];
    copy_name(ssid, add.ssid);
    snprintf(pass, sizeof(pass), "%s", add_pass);
    xSemaphoreGive(lock);
    set_failure(trying, -1);
    if (trying_add) {
        const esp_err_t err = settings_put_network(ssid, pass);
        add_finished(err == ESP_OK, err == ESP_ERR_NO_MEM ? "five networks are saved already" : "it was joined but could not be saved");
    } else {
        settings_network_to_top(trying);
    }
    memset(pass, 0, sizeof(pass));
    ESP_LOGI(TAG, "on Wi-Fi: saved network 1 of %d", settings_network_count());
    wifi_changed();  // first, so the bridge's hello carries it
    report_status();
}

static void forgot(const char *ssid) {
    set_failure(ssid, -1);
    xSemaphoreTake(lock, portMAX_DELAY);
    const bool in_use = online && strcmp(current, ssid) == 0;
    for (int i = 0; i < nearby_count; i++) {
        if (strcmp(nearby[i].ssid, ssid) == 0) nearby[i].saved = false;
    }
    xSemaphoreGive(lock);
    ESP_LOGI(TAG, "a saved network was forgotten (%d left)%s", settings_network_count(), in_use ? "; it was in use" : "");
    wifi_changed();  // tick() then leaves it, if it was in use
}

static void tick(void) {
    const int64_t now = now_ms();
    // A step that never reported back.
    if (radio == RADIO_CONNECTING && now >= deadline_ms) {
        leave(THEN_FAILED, REASON_TIMEOUT);
    } else if (radio == RADIO_LEAVING && now >= deadline_ms) {
        radio = RADIO_IDLE;
        after_leave();
    } else if (radio == RADIO_SCANNING && now >= deadline_ms) {
        esp_wifi_scan_stop();
        radio = RADIO_IDLE;
        xEventGroupSetBits(events, SCANNED_BIT);
        if (scan_for_round) {
            scan_for_round = false;
            round_failed();
        }
    }
    if (!sta_started) return;

    // The setup page's Add: leave whatever the station is doing, then join the new network.
    xSemaphoreTake(lock, portMAX_DELAY);
    const bool start = add_pending && now >= add_at_ms && (radio == RADIO_IDLE || radio == RADIO_CONNECTING);
    if (start) add_pending = false;
    const bool adding = add_pending || start;
    xSemaphoreGive(lock);
    if (start) {
        add_was_online = online;
        candidate_count = 0;
        if (online || radio == RADIO_CONNECTING) {
            leave(THEN_ADD, 0);
        } else {
            start_add();
        }
    }

    // On a network that is no longer saved (forgotten while in use): leave it and join another.
    if (online && radio == RADIO_IDLE && !adding) {
        xSemaphoreTake(lock, portMAX_DELAY);
        char ssid[33];
        copy_name(ssid, current);
        xSemaphoreGive(lock);
        if (!saved_position(ssid)) {
            ESP_LOGI(TAG, "leaving a network that is no longer saved");
            leave(THEN_ROUND, 0);
        }
    }

    if (scan_wanted && radio == RADIO_IDLE && !adding && !trying_add) {
        if (!start_scan(false)) scan_wanted = false;
    }

    if (!online && radio == RADIO_IDLE && !adding && !trying_add && now >= next_round_ms && settings_network_count() > 0) {
        if (phone_on_setup_network() && !force_round) {
            next_round_ms = now + RETRY_IN_SETUP_MS;  // joining could move the radio away from the phone
        } else {
            force_round = false;
            if (!start_scan(true)) round_failed();
        }
    }

    check_setup(now);

    if (online && now >= next_signal_ms) {
        next_signal_ms = now + SIGNAL_EVERY_MS;
        int rssi = 0;
        xSemaphoreTake(lock, portMAX_DELAY);
        const int reported = report_rssi;
        xSemaphoreGive(lock);
        if (esp_wifi_sta_get_rssi(&rssi) == ESP_OK && abs(rssi - reported) >= SIGNAL_STEP) wifi_changed();
    }
}

static void handle(const cmd_t *c) {
    switch (c->type) {
        case CMD_STA_START:
            sta_started = true;
            break;
        case CMD_SCAN_DONE:
            scan_done();
            break;
        case CMD_DISCONNECTED:
            disconnected(c->value);
            break;
        case CMD_GOT_IP:
            got_ip();
            break;
        case CMD_LINK:
            if (link_up != (c->value != 0)) {
                link_up = c->value != 0;
                if (!link_up) link_down_since_ms = now_ms();
            }
            break;
        case CMD_OPEN_SETUP:
            asked_until_ms = now_ms() + ASKED_MS;
            ESP_LOGI(TAG, "the setup network opens for %d minutes", ASKED_MS / 60000);
            break;
        case CMD_SCAN:
            scan_wanted = true;
            break;
        case CMD_ADD:  // its details are in `add`; this only wakes the task
            break;
        case CMD_FORGOT:
            forgot(c->ssid);
            break;
        case CMD_BRIDGE:
            bridge_set = true;
            link_down_since_ms = now_ms();
            on.bridge_changed();
            break;
    }
}

static void net_task(void *arg) {
    (void)arg;
    for (;;) {
        cmd_t c;
        if (xQueueReceive(commands, &c, pdMS_TO_TICKS(TICK_MS)) == pdTRUE) handle(&c);
        tick();
    }
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        post(CMD_STA_START, 0);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_SCAN_DONE) {
        post(CMD_SCAN_DONE, 0);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        post(CMD_DISCONNECTED, ((wifi_event_sta_disconnected_t *)data)->reason);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *got = data;
        ESP_LOGI(TAG, "on Wi-Fi, address " IPSTR, IP2STR(&got->ip_info.ip));
        post(CMD_GOT_IP, 0);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) {
        ESP_LOGI(TAG, "a phone joined the setup network");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED) {
        ESP_LOGI(TAG, "a phone left the setup network");
    }
}

esp_err_t net_start(bool have_bridge, const net_handlers_t *handlers) {
    on = *handlers;
    bridge_set = have_bridge;

    uint8_t mac[6];
    ESP_RETURN_ON_ERROR(esp_read_mac(mac, ESP_MAC_WIFI_STA), TAG, "reading the MAC address");
    snprintf(device_id, sizeof(device_id), "desk-%02x%02x%02x", mac[3], mac[4], mac[5]);
    snprintf(setup_ssid, sizeof(setup_ssid), "Desk-Setup-%02X%02X", mac[4], mac[5]);

    records = heap_caps_calloc(MAX_SCAN, sizeof(wifi_ap_record_t), MALLOC_CAP_SPIRAM);
    commands = xQueueCreate(24, sizeof(cmd_t));
    lock = xSemaphoreCreateMutex();
    events = xEventGroupCreate();
    if (!records || !commands || !lock || !events) return ESP_ERR_NO_MEM;

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop");
    esp_netif_create_default_wifi_sta();
    ap_netif = esp_netif_create_default_wifi_ap();
    const wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "wifi init");
    ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM), TAG, "wifi storage");  // settings.c keeps it
    ESP_RETURN_ON_ERROR(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL), TAG, "events");
    ESP_RETURN_ON_ERROR(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL), TAG, "events");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "wifi mode");
    xTaskCreate(net_task, "net", 6144, NULL, 5, NULL);
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start");
    esp_wifi_set_ps(WIFI_PS_NONE);  // USB powered: answer the bridge and stream audio without delay
    return ESP_OK;
}

const char *net_device_id(void) { return device_id; }

const char *net_setup_ssid(void) { return setup_ssid; }

const char *net_setup_password(void) { return setup_password; }

// ---- for the bridge link ----

void net_report(link_wifi_t *out) {
    memset(out, 0, sizeof(*out));  // link.c compares reports byte for byte
    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int n = settings_networks(saved);
    for (int i = 0; i < n && i < LINK_MAX_NETWORKS; i++) clean_name(saved[i].ssid, out->saved[i], sizeof(out->saved[i]));
    out->count = n < LINK_MAX_NETWORKS ? n : LINK_MAX_NETWORKS;
    memset(saved, 0, sizeof(saved));
    xSemaphoreTake(lock, portMAX_DELAY);
    if (current[0]) {
        clean_name(current, out->current, sizeof(out->current));
        out->rssi = report_rssi;
    }
    out->setup = setup_open;
    xSemaphoreGive(lock);
}

void net_bridge_link(bool up) { post(CMD_LINK, up ? 1 : 0); }

void net_open_setup(void) { post(CMD_OPEN_SETUP, 0); }

bool net_forget_network(const char *name) {
    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int n = settings_networks(saved);
    char found[33] = "";
    for (int i = 0; i < n && !found[0]; i++) {
        if (strcmp(saved[i].ssid, name) == 0) copy_name(found, saved[i].ssid);
    }
    for (int i = 0; i < n && !found[0]; i++) {
        char reported[33];
        clean_name(saved[i].ssid, reported, sizeof(reported));
        if (strcmp(reported, name) == 0) copy_name(found, saved[i].ssid);
    }
    memset(saved, 0, sizeof(saved));
    if (!found[0] || settings_forget_network(found) != ESP_OK) return false;
    cmd_t c = {.type = CMD_FORGOT};
    snprintf(c.ssid, sizeof(c.ssid), "%s", found);
    xQueueSend(commands, &c, pdMS_TO_TICKS(100));
    return true;
}

// ---- for the setup page ----

int net_nearby(net_nearby_t *out, int max) {
    xSemaphoreTake(lock, portMAX_DELAY);
    const int n = nearby_count < max ? nearby_count : max;
    memcpy(out, nearby, n * sizeof(net_nearby_t));
    xSemaphoreGive(lock);
    return n;
}

void net_scan(int wait_ms) {
    xEventGroupClearBits(events, SCANNED_BIT);
    post(CMD_SCAN, 0);
    xEventGroupWaitBits(events, SCANNED_BIT, pdTRUE, pdFALSE, pdMS_TO_TICKS(wait_ms));
}

int net_saved(net_saved_t out[SETTINGS_MAX_NETWORKS]) {
    settings_network_t saved[SETTINGS_MAX_NETWORKS];
    const int n = settings_networks(saved);
    memset(out, 0, SETTINGS_MAX_NETWORKS * sizeof(net_saved_t));
    xSemaphoreTake(lock, portMAX_DELAY);
    for (int i = 0; i < n; i++) {
        net_saved_t *s = &out[i];
        copy_name(s->ssid, saved[i].ssid);
        if (current[0] && strcmp(current, s->ssid) == 0) {
            s->state = NET_SAVED_IN_USE;
            s->rssi = report_rssi;
        }
        for (int j = 0; j < nearby_count && s->state == NET_SAVED_NOT_SEEN; j++) {
            if (strcmp(nearby[j].ssid, s->ssid) != 0) continue;
            s->state = NET_SAVED_NEARBY;
            s->rssi = nearby[j].rssi;
        }
        for (int j = 0; j < SETTINGS_MAX_NETWORKS; j++) {
            if (s->state != NET_SAVED_IN_USE && failures[j].ssid[0] && strcmp(failures[j].ssid, s->ssid) == 0) {
                snprintf(s->problem, sizeof(s->problem), "%s", reason_text(failures[j].reason));
            }
        }
    }
    xSemaphoreGive(lock);
    memset(saved, 0, sizeof(saved));
    return n;
}

const char *net_add(const char *ssid, const char *pass) {
    if (settings_network_count() >= SETTINGS_MAX_NETWORKS && !saved_position(ssid)) {
        return "Five networks are saved, the most this display keeps: forget one below first.";
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    const bool busy = add_pending || add.state == NET_ADD_CHECKING;
    if (!busy) {
        memset(&add, 0, sizeof(add));
        add.state = NET_ADD_CHECKING;
        copy_name(add.ssid, ssid);
        snprintf(add_pass, sizeof(add_pass), "%s", pass);
        add_pending = true;
        add_at_ms = now_ms() + ADD_DELAY_MS;
        linger_until_ms = now_ms() + LINGER_MS;
    }
    xSemaphoreGive(lock);
    if (busy) return "Another network is being checked: wait for its result.";
    post(CMD_ADD, 0);
    return NULL;
}

void net_add_result(net_add_t *out) {
    xSemaphoreTake(lock, portMAX_DELAY);
    *out = add;
    xSemaphoreGive(lock);
}

int net_setup_why(void) {
    xSemaphoreTake(lock, portMAX_DELAY);
    const int reasons = why;
    xSemaphoreGive(lock);
    return reasons;
}

void net_page_used(void) {
    xSemaphoreTake(lock, portMAX_DELAY);
    linger_until_ms = now_ms() + LINGER_MS;
    xSemaphoreGive(lock);
}

void net_bridge_saved(void) { post(CMD_BRIDGE, 0); }
