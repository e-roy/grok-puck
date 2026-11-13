#include "settings.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "settings";
static const char *NS = "desk";

#define DEFAULT_COLOR 0xf59e0b
#define DEFAULT_VOLUME 70

// The Wi-Fi networks: one blob, so adding, forgetting and reordering are each a single write.
#define NETWORKS_KEY "wifi"
#define NETWORKS_VERSION 1

typedef struct {
    uint8_t version;
    uint8_t count;
    settings_network_t list[SETTINGS_MAX_NETWORKS];  // most recently joined first
} networks_t;

static networks_t networks;  // what is saved, kept in memory
static SemaphoreHandle_t lock;

static esp_err_t set_str(nvs_handle_t h, const char *key, const char *value) {
    if (value[0] == '\0') {
        const esp_err_t err = nvs_erase_key(h, key);
        return err == ESP_ERR_NVS_NOT_FOUND ? ESP_OK : err;
    }
    return nvs_set_str(h, key, value);
}

static void get_str(nvs_handle_t h, const char *key, char *out, size_t size) {
    size_t len = size;
    if (nvs_get_str(h, key, out, &len) != ESP_OK) out[0] = '\0';
}

// ---- the network list (lock held) ----

static int find(const char *ssid) {
    for (int i = 0; i < networks.count; i++) {
        if (strcmp(networks.list[i].ssid, ssid) == 0) return i;
    }
    return -1;
}

// Moves entry `from` to the top, shifting the ones above it down.
static void move_to_top(int from) {
    if (from <= 0) return;
    const settings_network_t moved = networks.list[from];
    memmove(&networks.list[1], &networks.list[0], from * sizeof(settings_network_t));
    networks.list[0] = moved;
}

static void remove_at(int at) {
    memmove(&networks.list[at], &networks.list[at + 1], (networks.count - at - 1) * sizeof(settings_network_t));
    networks.count--;
    memset(&networks.list[networks.count], 0, sizeof(settings_network_t));
}

static esp_err_t write_networks(nvs_handle_t h) {
    networks.version = NETWORKS_VERSION;
    esp_err_t err = nvs_set_blob(h, NETWORKS_KEY, &networks, sizeof(networks));
    if (err == ESP_OK) err = nvs_commit(h);
    return err;
}

// Writes the list after a change; on failure the list goes back to `before`.
static esp_err_t save_networks(const networks_t *before) {
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err == ESP_OK) {
        err = write_networks(h);
        nvs_close(h);
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "saving the Wi-Fi networks failed: %s", esp_err_to_name(err));
        networks = *before;
    }
    return err;
}

static void read_networks(nvs_handle_t h) {
    memset(&networks, 0, sizeof(networks));
    size_t len = sizeof(networks);
    if (nvs_get_blob(h, NETWORKS_KEY, &networks, &len) != ESP_OK || len != sizeof(networks) ||
        networks.version != NETWORKS_VERSION || networks.count > SETTINGS_MAX_NETWORKS) {
        memset(&networks, 0, sizeof(networks));
        return;
    }
    // Keep only well-formed entries.
    int kept = 0;
    for (int i = 0; i < networks.count; i++) {
        settings_network_t *n = &networks.list[i];
        n->ssid[sizeof(n->ssid) - 1] = '\0';
        n->pass[sizeof(n->pass) - 1] = '\0';
        if (n->ssid[0]) networks.list[kept++] = *n;
    }
    networks.count = kept;
    memset(&networks.list[kept], 0, (SETTINGS_MAX_NETWORKS - kept) * sizeof(settings_network_t));
}

// Firmware before 0.6.0 kept one network in "ssid" and "pass". It goes to the top of the list, then
// the old keys are erased. Safe to repeat: a start interrupted half-way finishes the move next time.
static void move_single_network(nvs_handle_t h) {
    settings_network_t old = {0};
    get_str(h, "ssid", old.ssid, sizeof(old.ssid));
    if (old.ssid[0]) {
        get_str(h, "pass", old.pass, sizeof(old.pass));
        int at = find(old.ssid);
        if (at < 0) {
            if (networks.count == SETTINGS_MAX_NETWORKS) networks.count--;  // can't happen on a first move
            memmove(&networks.list[1], &networks.list[0], networks.count * sizeof(settings_network_t));
            networks.list[0] = old;
            networks.count++;
        } else {
            move_to_top(at);
        }
        memset(&old, 0, sizeof(old));
        if (write_networks(h) != ESP_OK) {
            ESP_LOGE(TAG, "couldn't move the saved Wi-Fi network into the list; trying again next start");
            return;
        }
        ESP_LOGI(TAG, "moved the saved Wi-Fi network into the list of saved networks");
    }
    // "last_err" was the setup page's message from older firmware; nothing reads it any more.
    set_str(h, "ssid", "");
    set_str(h, "pass", "");
    set_str(h, "last_err", "");
    nvs_commit(h);
}

esp_err_t settings_init(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "settings storage was full or from another version; starting fresh");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    if (err != ESP_OK) return err;
    lock = xSemaphoreCreateMutex();
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) == ESP_OK) {
        read_networks(h);
        move_single_network(h);
        nvs_close(h);
    }
    ESP_LOGI(TAG, "%d saved Wi-Fi network%s", networks.count, networks.count == 1 ? "" : "s");
    return ESP_OK;
}

void settings_load(settings_t *out) {
    memset(out, 0, sizeof(*out));
    out->color = DEFAULT_COLOR;
    out->volume = DEFAULT_VOLUME;
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return;  // nothing saved yet
    get_str(h, "bridge", out->bridge_url, sizeof(out->bridge_url));
    get_str(h, "key", out->device_key, sizeof(out->device_key));
    nvs_get_u8(h, "shape", &out->shape);
    nvs_get_u32(h, "color", &out->color);
    nvs_get_u8(h, "volume", &out->volume);
    uint8_t muted = 0;
    nvs_get_u8(h, "muted", &muted);
    out->muted = muted;
    nvs_close(h);
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

esp_err_t settings_save_bridge(const char *url, bool *changed) {
    *changed = false;
    nvs_handle_t h;
    esp_err_t err = nvs_open(NS, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    char old[192];
    get_str(h, "bridge", old, sizeof(old));
    if (strcmp(old, url) != 0) {
        *changed = true;
        err = set_str(h, "bridge", url);
        if (err == ESP_OK) err = set_str(h, "key", "");
        if (err == ESP_OK) err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

int settings_networks(settings_network_t out[SETTINGS_MAX_NETWORKS]) {
    xSemaphoreTake(lock, portMAX_DELAY);
    memcpy(out, networks.list, sizeof(networks.list));
    const int count = networks.count;
    xSemaphoreGive(lock);
    return count;
}

int settings_network_count(void) {
    xSemaphoreTake(lock, portMAX_DELAY);
    const int count = networks.count;
    xSemaphoreGive(lock);
    return count;
}

esp_err_t settings_put_network(const char *ssid, const char *pass) {
    if (!ssid[0] || strlen(ssid) >= sizeof(networks.list[0].ssid) || strlen(pass) >= sizeof(networks.list[0].pass)) {
        return ESP_ERR_INVALID_ARG;
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    const networks_t before = networks;
    int at = find(ssid);
    esp_err_t err = ESP_OK;
    if (at < 0) {
        if (networks.count == SETTINGS_MAX_NETWORKS) {
            err = ESP_ERR_NO_MEM;
        } else {
            at = networks.count++;
            snprintf(networks.list[at].ssid, sizeof(networks.list[at].ssid), "%s", ssid);
        }
    }
    if (err == ESP_OK) {
        snprintf(networks.list[at].pass, sizeof(networks.list[at].pass), "%s", pass);
        move_to_top(at);
        err = save_networks(&before);
    }
    xSemaphoreGive(lock);
    return err;
}

esp_err_t settings_network_to_top(const char *ssid) {
    xSemaphoreTake(lock, portMAX_DELAY);
    const int at = find(ssid);
    esp_err_t err = at < 0 ? ESP_ERR_NOT_FOUND : ESP_OK;
    if (at > 0) {  // already at the top: nothing to write
        const networks_t before = networks;
        move_to_top(at);
        err = save_networks(&before);
    }
    xSemaphoreGive(lock);
    return err;
}

esp_err_t settings_forget_network(const char *ssid) {
    xSemaphoreTake(lock, portMAX_DELAY);
    const int at = find(ssid);
    esp_err_t err = ESP_ERR_NOT_FOUND;
    if (at >= 0) {
        const networks_t before = networks;
        remove_at(at);
        err = save_networks(&before);
    }
    xSemaphoreGive(lock);
    return err;
}

esp_err_t settings_forget_networks(void) {
    xSemaphoreTake(lock, portMAX_DELAY);
    const networks_t before = networks;
    memset(&networks, 0, sizeof(networks));
    const esp_err_t err = save_networks(&before);
    xSemaphoreGive(lock);
    return err;
}
