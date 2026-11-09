#include "portal.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "lwip/sockets.h"

static const char *TAG = "setup";

#define MAX_NETWORKS 16
#define PAGE_SIZE 9000
#define BODY_SIZE 640

static httpd_handle_t server;
static uint32_t portal_ip;  // network byte order
static char root_url[32];
static const settings_t *saved;
static volatile bool dns_running;
static TaskHandle_t dns_task_handle;
static wifi_ap_record_t *networks;
static int network_count;

// ---- DNS: every A query is answered with the device's address ----

// Turns the query in buf (n bytes) into its answer in place; returns the answer's length, or 0.
static int dns_answer(uint8_t *buf, int n, int capacity) {
    if (n < 12 || (buf[2] & 0x80) || ((buf[2] >> 3) & 0x0f) != 0) return 0;  // a response, or not a query
    if ((buf[4] << 8 | buf[5]) != 1) return 0;                               // exactly one question
    int at = 12;
    while (at < n && buf[at] != 0) {
        if (buf[at] & 0xc0) return 0;  // no name compression in a question
        at += buf[at] + 1;
    }
    at += 1;
    if (at + 4 > n) return 0;
    const bool a_record = buf[at] == 0 && buf[at + 1] == 1 && buf[at + 2] == 0 && buf[at + 3] == 1;  // A, IN
    at += 4;
    if (a_record && at + 16 > capacity) return 0;
    buf[2] = 0x84 | (buf[2] & 0x01);  // a response, authoritative; keeps "recursion desired"
    buf[3] = 0x80;                    // recursion available, no error
    buf[6] = 0;
    buf[7] = a_record ? 1 : 0;
    memset(buf + 8, 0, 4);  // no authority or additional records (drops EDNS)
    if (!a_record) return at;
    const uint8_t answer[12] = {0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4};  // the name above, A, IN, 30 s
    memcpy(buf + at, answer, sizeof(answer));
    memcpy(buf + at + sizeof(answer), &portal_ip, 4);
    return at + 16;
}

static void dns_task(void *arg) {
    (void)arg;
    const int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    struct sockaddr_in addr = {.sin_family = AF_INET, .sin_port = htons(53), .sin_addr.s_addr = htonl(INADDR_ANY)};
    if (sock < 0 || bind(sock, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        ESP_LOGE(TAG, "DNS responder could not start");
        if (sock >= 0) close(sock);
        dns_task_handle = NULL;
        vTaskDelete(NULL);
    }
    const struct timeval timeout = {.tv_sec = 1};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    uint8_t buf[512];
    while (dns_running) {
        struct sockaddr_in from;
        socklen_t from_len = sizeof(from);
        const int n = recvfrom(sock, buf, sizeof(buf), 0, (struct sockaddr *)&from, &from_len);
        if (n <= 0) continue;
        const int len = dns_answer(buf, n, sizeof(buf));
        if (len > 0) sendto(sock, buf, len, 0, (struct sockaddr *)&from, from_len);
    }
    close(sock);
    dns_task_handle = NULL;
    vTaskDelete(NULL);
}

// ---- small helpers ----

typedef struct {
    char *buf;
    size_t len;
    size_t size;
} page_t;

static void put(page_t *p, const char *s) {
    const size_t n = strlen(s);
    if (p->len + n >= p->size) return;
    memcpy(p->buf + p->len, s, n + 1);
    p->len += n;
}

// Text for HTML, including attribute values.
static void put_escaped(page_t *p, const char *s) {
    for (; *s; s++) {
        switch (*s) {
            case '&': put(p, "&amp;"); break;
            case '<': put(p, "&lt;"); break;
            case '>': put(p, "&gt;"); break;
            case '"': put(p, "&quot;"); break;
            case '\'': put(p, "&#39;"); break;
            default: {
                const char c[2] = {*s, 0};
                put(p, c);
            }
        }
    }
}

static int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// One field of an application/x-www-form-urlencoded body, decoded. False if missing or too long.
static bool form_field(const char *body, const char *name, char *out, size_t size) {
    const size_t name_len = strlen(name);
    for (const char *p = body; p && *p; p = strchr(p, '&'), p = p ? p + 1 : NULL) {
        if (strncmp(p, name, name_len) != 0 || p[name_len] != '=') continue;
        size_t n = 0;
        for (p += name_len + 1; *p && *p != '&'; p++) {
            char c = *p;
            if (c == '+') {
                c = ' ';
            } else if (c == '%' && hex_value(p[1]) >= 0 && hex_value(p[2]) >= 0) {
                c = (char)(hex_value(p[1]) << 4 | hex_value(p[2]));
                p += 2;
            }
            if (n + 1 >= size) return false;
            out[n++] = c;
        }
        out[n] = '\0';
        return true;
    }
    out[0] = '\0';
    return false;
}

static void trim(char *s) {
    char *start = s;
    while (*start == ' ' || *start == '\t') start++;
    memmove(s, start, strlen(start) + 1);
    size_t n = strlen(s);
    while (n > 0 && (s[n - 1] == ' ' || s[n - 1] == '\t')) s[--n] = '\0';
}

bool portal_bridge_url(const char *typed, char *out, size_t size) {
    char url[192];
    snprintf(url, sizeof(url), "%s", typed);
    trim(url);
    const char *scheme = NULL;
    const char *rest = url;
    static const struct {
        const char *prefix, *scheme;
    } known[] = {{"wss://", "wss://"}, {"ws://", "ws://"}, {"https://", "wss://"}, {"http://", "ws://"}};
    for (size_t i = 0; i < sizeof(known) / sizeof(known[0]); i++) {
        if (strncasecmp(url, known[i].prefix, strlen(known[i].prefix)) == 0) {
            scheme = known[i].scheme;
            rest = url + strlen(known[i].prefix);
            break;
        }
    }
    if (*rest == '\0' || *rest == '/' || strchr(rest, ' ')) return false;
    const char *slash = strchr(rest, '/');
    const size_t host_len = slash ? (size_t)(slash - rest) : strlen(rest);
    if (!scheme) {
        // An address with a port, or a bare IP, is on the home network: plain ws://. A name is
        // reached through the tunnel: wss://.
        bool has_port = memchr(rest, ':', host_len) != NULL;
        bool is_ip = true;
        for (size_t i = 0; i < host_len; i++) is_ip &= isdigit((unsigned char)rest[i]) || rest[i] == '.';
        scheme = (has_port || is_ip) ? "ws://" : "wss://";
    }
    const bool needs_path = !slash || slash[1] == '\0';
    const int n = snprintf(out, size, "%s%.*s%s", scheme, (int)host_len, rest, needs_path ? "/device" : slash);
    return n > 0 && (size_t)n < size;
}

static void scan_networks(void) {
    const wifi_scan_config_t cfg = {.show_hidden = false};
    if (esp_wifi_scan_start(&cfg, true) != ESP_OK) {
        ESP_LOGW(TAG, "network scan failed");
        return;
    }
    uint16_t found = MAX_NETWORKS;
    if (esp_wifi_scan_get_ap_records(&found, networks) != ESP_OK) found = 0;
    // Drop hidden and repeated names (one network with several access points); the strongest stays.
    int kept = 0;
    for (int i = 0; i < found; i++) {
        bool repeat = networks[i].ssid[0] == '\0';
        for (int j = 0; j < kept && !repeat; j++) repeat = strcmp((char *)networks[j].ssid, (char *)networks[i].ssid) == 0;
        if (!repeat) networks[kept++] = networks[i];
    }
    network_count = kept;
}

// ---- pages ----

static const char PAGE_HEAD[] =
    "<!doctype html><html lang=en><head><meta charset=utf-8>"
    "<meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Desk display setup</title><style>"
    "body{font:16px/1.4 system-ui,sans-serif;margin:0;padding:20px;background:#111;color:#eee}"
    "main{max-width:420px;margin:auto}h1{font-size:22px}"
    "label{display:block;margin:16px 0 6px;font-weight:600}"
    "input{width:100%;box-sizing:border-box;padding:11px;font-size:16px;border-radius:8px;border:1px solid #555;"
    "background:#1c1c1c;color:#eee}"
    ".nets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}"
    ".nets button{background:#262626;color:#eee;border:1px solid #444;border-radius:16px;padding:6px 12px;font-size:14px}"
    "button.go{margin-top:24px;width:100%;padding:13px;font-size:16px;border:0;border-radius:8px;background:#f59e0b;"
    "color:#111;font-weight:700}"
    ".note{color:#aaa;font-size:14px;margin:6px 0 0}.err{background:#3b1d1d;border-radius:8px;padding:10px 12px;color:#fca5a5}"
    "a{color:#fbbf24}code{color:#fde68a}"
    "</style></head><body><main>";
static const char PAGE_TAIL[] = "</main></body></html>";

static esp_err_t send_page(httpd_req_t *req, page_t *p) {
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, p->buf, p->len);
}

static esp_err_t root_get(httpd_req_t *req) {
    char query[16] = "";
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK && strstr(query, "scan")) scan_networks();
    if (network_count == 0) scan_networks();

    page_t p = {.buf = heap_caps_malloc(PAGE_SIZE, MALLOC_CAP_SPIRAM), .size = PAGE_SIZE};
    if (!p.buf) return httpd_resp_send_500(req);
    p.buf[0] = '\0';
    put(&p, PAGE_HEAD);
    put(&p, "<h1>Desk display setup</h1>");
    if (saved->last_error[0]) {
        put(&p, "<p class=err>");
        put_escaped(&p, saved->last_error);
        put(&p, "</p>");
    }
    put(&p, "<form method=post action=/save><label for=ssid>Wi-Fi network</label>"
            "<input id=ssid name=ssid maxlength=32 required autocomplete=off autocapitalize=off value=\"");
    put_escaped(&p, saved->wifi_ssid);
    put(&p, "\"><div class=nets>");
    for (int i = 0; i < network_count; i++) {
        put(&p, "<button type=button onclick=\"ssid.value=this.textContent;pass.focus()\">");
        put_escaped(&p, (const char *)networks[i].ssid);
        put(&p, "</button>");
    }
    put(&p, "</div><p class=note><a href=\"/?scan=1\">Search again</a></p>"
            "<label for=pass>Wi-Fi password</label>"
            "<input id=pass name=pass type=password maxlength=64 autocomplete=off>"
            "<label for=bridge>Bridge address</label>"
            "<input id=bridge name=bridge maxlength=180 required autocomplete=off autocapitalize=off spellcheck=false "
            "placeholder=\"wss://desk.example.com\" value=\"");
    put_escaped(&p, saved->bridge_url);
    put(&p, "\"><p class=note>Through the tunnel: its name, like <code>desk.example.com</code>. On the home network: "
            "the computer running the bridge and port 8787, like <code>192.168.1.20:8787</code>.</p>"
            "<button class=go>Save and connect</button></form>");
    put(&p, PAGE_TAIL);
    const esp_err_t err = send_page(req, &p);
    heap_caps_free(p.buf);
    return err;
}

static void restart_now(void *arg) {
    (void)arg;
    esp_restart();
}

static esp_err_t message_page(httpd_req_t *req, const char *html) {
    page_t p = {.buf = heap_caps_malloc(PAGE_SIZE, MALLOC_CAP_SPIRAM), .size = PAGE_SIZE};
    if (!p.buf) return httpd_resp_send_500(req);
    p.buf[0] = '\0';
    put(&p, PAGE_HEAD);
    put(&p, html);
    put(&p, PAGE_TAIL);
    const esp_err_t err = send_page(req, &p);
    heap_caps_free(p.buf);
    return err;
}

static esp_err_t save_post(httpd_req_t *req) {
    char body[BODY_SIZE];
    if (req->content_len >= sizeof(body)) return message_page(req, "<p class=err>That was too long.</p><p><a href=/>Back</a></p>");
    size_t got = 0;
    while (got < req->content_len) {
        const int n = httpd_req_recv(req, body + got, req->content_len - got);
        if (n <= 0) return ESP_FAIL;
        got += n;
    }
    body[got] = '\0';

    char ssid[33], pass[65], typed[192], url[192];
    const bool ok = form_field(body, "ssid", ssid, sizeof(ssid)) && form_field(body, "pass", pass, sizeof(pass)) &&
                    form_field(body, "bridge", typed, sizeof(typed));
    memset(body, 0, sizeof(body));  // the password
    const size_t pass_len = strlen(pass);
    const char *problem = NULL;
    if (!ok || ssid[0] == '\0') {
        problem = "Choose or type the Wi-Fi network.";
    } else if (pass_len != 0 && (pass_len < 8 || pass_len > 63)) {
        problem = "A Wi-Fi password has 8 to 63 characters (or none for an open network).";
    } else if (!portal_bridge_url(typed, url, sizeof(url))) {
        problem = "The bridge address doesn't look right. Example: desk.example.com or 192.168.1.20:8787";
    }
    if (problem) {
        memset(pass, 0, sizeof(pass));
        char html[320];
        snprintf(html, sizeof(html), "<p class=err>%s</p><p><a href=/>Back</a></p>", problem);
        return message_page(req, html);
    }

    const esp_err_t saved_ok = settings_save_setup(ssid, pass, url);
    memset(pass, 0, sizeof(pass));
    if (saved_ok != ESP_OK) {
        ESP_LOGE(TAG, "saving the settings failed: %s", esp_err_to_name(saved_ok));
        return message_page(req, "<p class=err>The settings could not be saved. Try again.</p><p><a href=/>Back</a></p>");
    }
    ESP_LOGI(TAG, "settings saved; restarting to join the network");
    message_page(req, "<h1>Saved</h1><p>The display restarts and joins your Wi-Fi. This page can be closed.</p>"
                      "<p class=note>If it can't join, this setup network opens again within about a minute.</p>");
    static esp_timer_handle_t restart_timer;
    const esp_timer_create_args_t args = {.callback = restart_now, .name = "restart"};
    if (!restart_timer && esp_timer_create(&args, &restart_timer) == ESP_OK) esp_timer_start_once(restart_timer, 1500 * 1000);
    return ESP_OK;
}

// Every other address leads to the setup page; this is also what makes phones notice it.
static esp_err_t redirect(httpd_req_t *req, httpd_err_code_t err) {
    (void)err;
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", root_url);
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, "Desk display setup", HTTPD_RESP_USE_STRLEN);  // iOS wants a body
}

esp_err_t portal_start(uint32_t ip, const settings_t *settings) {
    if (server) return ESP_OK;
    portal_ip = ip;
    saved = settings;
    struct in_addr a = {.s_addr = ip};
    snprintf(root_url, sizeof(root_url), "http://%s/", inet_ntoa(a));
    if (!networks) networks = heap_caps_calloc(MAX_NETWORKS, sizeof(wifi_ap_record_t), MALLOC_CAP_SPIRAM);
    network_count = 0;
    if (networks) scan_networks();

    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.stack_size = 6144;
    cfg.max_open_sockets = 7;
    cfg.lru_purge_enable = true;
    esp_err_t err = httpd_start(&server, &cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "web server could not start: %s", esp_err_to_name(err));
        return err;
    }
    const httpd_uri_t root = {.uri = "/", .method = HTTP_GET, .handler = root_get};
    const httpd_uri_t save = {.uri = "/save", .method = HTTP_POST, .handler = save_post};
    httpd_register_uri_handler(server, &root);
    httpd_register_uri_handler(server, &save);
    httpd_register_err_handler(server, HTTPD_404_NOT_FOUND, redirect);

    dns_running = true;
    xTaskCreate(dns_task, "dns", 3072, NULL, 4, &dns_task_handle);
    ESP_LOGI(TAG, "setup page at %s", root_url);
    return ESP_OK;
}

void portal_stop(void) {
    dns_running = false;  // the DNS task ends within a second
    if (server) {
        httpd_stop(server);
        server = NULL;
    }
}
