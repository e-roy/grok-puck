#include "net.h"

#include <stdio.h>
#include <string.h>

#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "portal.h"

static const char *TAG = "net";

#define SETUP_AFTER_MS (60 * 1000)     // no Wi-Fi this long after starting: open the setup network
#define RETRY_IN_SETUP_MS (30 * 1000)  // how often the saved network is tried while setup is open
#define RETRY_MAX_MS (15 * 1000)

// Easy to read and type: no 0/o, 1/l/i.
static const char PASSWORD_LETTERS[] = "abcdefghjkmnpqrstuvwxyz23456789";

typedef enum { CMD_CONNECT, CMD_LOST, CMD_GOT_IP, CMD_ENTER_SETUP } command_t;

static QueueHandle_t commands;
static esp_timer_handle_t retry_timer;
static esp_timer_handle_t setup_timer;
static void (*state_cb)(net_state_t);
static const settings_t *saved;
static esp_netif_t *ap_netif;
static char device_id[16];
static char setup_ssid[20];
static char setup_password[12];
static char captive_uri[32];
static bool have_network;
static bool online;
static bool ever_online;
static bool in_setup;
static int retry_ms = 1000;
static uint8_t last_reason;

static void post(command_t command) { xQueueSend(commands, &command, 0); }

static void on_retry_timer(void *arg) { post(CMD_CONNECT); }

static void on_setup_timer(void *arg) { post(CMD_ENTER_SETUP); }

static void retry_in(int ms) {
    esp_timer_stop(retry_timer);
    esp_timer_start_once(retry_timer, (uint64_t)ms * 1000);
}

static const char *reason_text(uint8_t reason) {
    switch (reason) {
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

static bool phone_on_setup_network(void) {
    wifi_sta_list_t list;
    return esp_wifi_ap_get_sta_list(&list) == ESP_OK && list.num > 0;
}

static void enter_setup(void) {
    in_setup = true;
    for (int i = 0; i < 8; i++) setup_password[i] = PASSWORD_LETTERS[esp_random() % (sizeof(PASSWORD_LETTERS) - 1)];
    setup_password[8] = '\0';
    if (have_network) {
        char message[sizeof(((settings_t *)0)->last_error)];
        snprintf(message, sizeof(message), "Couldn't join %.32s: %s.", saved->wifi_ssid, reason_text(last_reason));
        settings_save_error(message);
    }

    wifi_config_t ap = {0};
    memcpy(ap.ap.ssid, setup_ssid, strlen(setup_ssid));
    ap.ap.ssid_len = strlen(setup_ssid);
    memcpy(ap.ap.password, setup_password, strlen(setup_password));
    ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
    ap.ap.max_connection = 2;
    ap.ap.channel = 1;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));

    // DHCP option 114 tells phones where the setup page is, so they open it by themselves.
    esp_netif_ip_info_t ip;
    esp_netif_get_ip_info(ap_netif, &ip);
    snprintf(captive_uri, sizeof(captive_uri), "http://" IPSTR "/", IP2STR(&ip.ip));
    esp_netif_dhcps_stop(ap_netif);
    esp_netif_dhcps_option(ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI, captive_uri, strlen(captive_uri));
    esp_netif_dhcps_start(ap_netif);

    portal_start(ip.ip.addr, saved);
    ESP_LOGI(TAG, "setup network %s is open", setup_ssid);
    state_cb(NET_SETUP);
    if (have_network) retry_in(RETRY_IN_SETUP_MS);
}

static void leave_setup(void) {
    portal_stop();
    esp_wifi_set_mode(WIFI_MODE_STA);
    in_setup = false;
    settings_save_error("");
    ESP_LOGI(TAG, "setup network closed");
}

static void net_task(void *arg) {
    (void)arg;
    for (;;) {
        command_t command;
        if (xQueueReceive(commands, &command, portMAX_DELAY) != pdTRUE) continue;
        switch (command) {
            case CMD_CONNECT:
                if (!have_network || online) break;
                if (in_setup && phone_on_setup_network()) {
                    retry_in(RETRY_IN_SETUP_MS);  // trying would move the radio away from the phone
                    break;
                }
                ESP_LOGI(TAG, "joining the saved network");
                esp_wifi_connect();
                break;
            case CMD_LOST:
                if (online) {
                    online = false;
                    retry_ms = 1000;
                    ESP_LOGW(TAG, "Wi-Fi lost");
                    state_cb(NET_JOINING);
                } else {
                    ESP_LOGW(TAG, "couldn't join: %s (reason %d)", reason_text(last_reason), last_reason);
                }
                if (in_setup) {
                    retry_in(RETRY_IN_SETUP_MS);
                } else {
                    retry_in(retry_ms);
                    retry_ms = retry_ms * 2 > RETRY_MAX_MS ? RETRY_MAX_MS : retry_ms * 2;
                }
                break;
            case CMD_GOT_IP:
                online = ever_online = true;
                retry_ms = 1000;
                esp_timer_stop(setup_timer);
                esp_timer_stop(retry_timer);
                if (in_setup) leave_setup();
                state_cb(NET_ONLINE);
                break;
            case CMD_ENTER_SETUP:
                if (!ever_online && !in_setup) enter_setup();
                break;
        }
    }
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        post(CMD_CONNECT);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        last_reason = ((wifi_event_sta_disconnected_t *)data)->reason;
        post(CMD_LOST);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *got = data;
        ESP_LOGI(TAG, "on Wi-Fi, address " IPSTR, IP2STR(&got->ip_info.ip));
        post(CMD_GOT_IP);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) {
        ESP_LOGI(TAG, "a phone joined the setup network");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED) {
        ESP_LOGI(TAG, "a phone left the setup network");
    }
}

esp_err_t net_start(const settings_t *settings, void (*on_state)(net_state_t state)) {
    saved = settings;
    state_cb = on_state;
    have_network = settings->wifi_ssid[0] != '\0';

    uint8_t mac[6];
    ESP_RETURN_ON_ERROR(esp_read_mac(mac, ESP_MAC_WIFI_STA), TAG, "reading the MAC address");
    snprintf(device_id, sizeof(device_id), "desk-%02x%02x%02x", mac[3], mac[4], mac[5]);
    snprintf(setup_ssid, sizeof(setup_ssid), "Desk-Setup-%02X%02X", mac[4], mac[5]);

    commands = xQueueCreate(8, sizeof(command_t));
    const esp_timer_create_args_t retry_args = {.callback = on_retry_timer, .name = "wifi_retry"};
    const esp_timer_create_args_t setup_args = {.callback = on_setup_timer, .name = "wifi_setup"};
    ESP_RETURN_ON_ERROR(esp_timer_create(&retry_args, &retry_timer), TAG, "timer");
    ESP_RETURN_ON_ERROR(esp_timer_create(&setup_args, &setup_timer), TAG, "timer");
    xTaskCreate(net_task, "net", 6144, NULL, 5, NULL);

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
    if (have_network) {
        wifi_config_t sta = {0};
        memcpy(sta.sta.ssid, settings->wifi_ssid, strlen(settings->wifi_ssid));
        memcpy(sta.sta.password, settings->wifi_pass, strlen(settings->wifi_pass));
        sta.sta.pmf_cfg.capable = true;
        ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &sta), TAG, "wifi config");
    }
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start");
    esp_wifi_set_ps(WIFI_PS_NONE);  // USB powered: answer the bridge and stream audio without delay

    if (have_network) {
        esp_timer_start_once(setup_timer, (uint64_t)SETUP_AFTER_MS * 1000);
    } else {
        post(CMD_ENTER_SETUP);
    }
    return ESP_OK;
}

const char *net_device_id(void) { return device_id; }

const char *net_setup_ssid(void) { return setup_ssid; }

const char *net_setup_password(void) { return setup_password; }
