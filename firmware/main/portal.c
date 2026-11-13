#include "portal.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "lwip/sockets.h"
#include "net.h"
#include "settings.h"

static const char *TAG = "setup";

#define MAX_NEARBY 16
#define PAGE_SIZE 16384
#define BODY_SIZE 640
#define SCAN_WAIT_MS 5000

static httpd_handle_t server;
static uint32_t portal_ip;  // network byte order
static char root_url[32];
static volatile bool dns_running;
static TaskHandle_t dns_task_handle;

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


// A Wi-Fi name as hex, so a Forget button names it exactly whatever bytes it holds.
static void put_hex(page_t *p, const char *s) {
    static const char HEX[] = "0123456789abcdef";
    for (; *s; s++) {
        const char c[3] = {HEX[(unsigned char)*s >> 4], HEX[(unsigned char)*s & 0xf], 0};
        put(p, c);
    }
}

static bool from_hex(const char *hex, char *out, size_t size) {
    const size_t n = strlen(hex);
    if (n == 0 || n % 2 || n / 2 >= size) return false;
    for (size_t i = 0; i < n / 2; i++) {
        const int hi = hex_value(hex[2 * i]), lo = hex_value(hex[2 * i + 1]);
        if (hi < 0 || lo < 0 || (hi == 0 && lo == 0)) return false;
        out[i] = (char)(hi << 4 | lo);
    }
    out[n / 2] = '\0';
    return true;
}

static const char *signal_word(int rssi) {
    if (rssi >= -55) return "strong";
    if (rssi >= -67) return "good";
    if (rssi >= -75) return "fair";
    return "weak";
}

// ---- pages ----

static const char PAGE_HEAD[] =
    "<!doctype html><html lang=en><head><meta charset=utf-8>"
    "<meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Desk display setup</title><style>"
    "body{font:16px/1.4 system-ui,sans-serif;margin:0;padding:20px;background:#111;color:#eee}"
    "main{max-width:420px;margin:auto}h1{font-size:22px}h2{font-size:17px;margin:30px 0 4px}"
    "label{display:block;margin:14px 0 6px;font-weight:600}"
    "input{width:100%;box-sizing:border-box;padding:11px;font-size:16px;border-radius:8px;border:1px solid #555;"
    "background:#1c1c1c;color:#eee}"
    ".nets{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}"
    ".nets button{background:#262626;color:#eee;border:1px solid #444;border-radius:16px;padding:6px 12px;font-size:14px}"
    ".nets small{color:#86efac}"
    "button.go{margin-top:18px;width:100%;padding:13px;font-size:16px;border:0;border-radius:8px;background:#f59e0b;"
    "color:#111;font-weight:700}"
    "ul{list-style:none;padding:0;margin:8px 0}li{display:flex;align-items:center;gap:10px;padding:10px 0;"
    "border-bottom:1px solid #2a2a2a}li div{flex:1;min-width:0;overflow-wrap:anywhere}"
    "li button{background:none;color:#fca5a5;border:1px solid #7f1d1d;border-radius:8px;padding:8px 12px;font-size:14px}"
    ".note{color:#aaa;font-size:14px;margin:6px 0 0}.err,.ok,.info{border-radius:8px;padding:10px 12px;margin:12px 0}"
    ".err{background:#3b1d1d;color:#fca5a5}.ok{background:#14301f;color:#86efac}.info{background:#262626}"
    "a{color:#fbbf24}code{color:#fde68a}button:disabled{opacity:.6}"
    ".spin{display:inline-block;width:14px;height:14px;margin-right:8px;vertical-align:-2px;border:2px solid #555;"
    "border-top-color:#f59e0b;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(1turn)}}"
    "</style></head><body><main>";
static const char PAGE_TAIL[] = "</main></body></html>";

// While a network is being checked: ask every 2 s, and show the result once it is in. The phone may be
// off the setup network for a while (the device's radio moves to the new network's channel), so a
// request that fails is simply tried again.
static const char POLL_SCRIPT[] =
    "<script>(function p(){setTimeout(function(){var c=new AbortController(),t=setTimeout(function(){c.abort()},3000);"
    "fetch('/status',{cache:'no-store',signal:c.signal}).then(function(r){return r.json()}).then(function(s){"
    "clearTimeout(t);s.add==='checking'?p():location.replace('/')}).catch(function(){clearTimeout(t);p()})},2000)})()"
    "</script>";

static page_t new_page(void) {
    page_t p = {.buf = heap_caps_malloc(PAGE_SIZE, MALLOC_CAP_SPIRAM), .size = PAGE_SIZE};
    if (p.buf) {
        p.buf[0] = '\0';
        put(&p, PAGE_HEAD);
    }
    return p;
}

static esp_err_t send_page(httpd_req_t *req, page_t *p) {
    put(p, PAGE_TAIL);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    const esp_err_t err = httpd_resp_send(req, p->buf, p->len);
    heap_caps_free(p->buf);
    return err;
}

static esp_err_t message_page(httpd_req_t *req, const char *html) {
    page_t p = new_page();
    if (!p.buf) return httpd_resp_send_500(req);
    put(&p, html);
    return send_page(req, &p);
}

static esp_err_t problem_page(httpd_req_t *req, const char *problem) {
    page_t p = new_page();
    if (!p.buf) return httpd_resp_send_500(req);
    put(&p, "<p class=err>");
    put_escaped(&p, problem);
    put(&p, "</p><p><a href=/>Back</a></p>");
    return send_page(req, &p);
}

// After a form: back to the page, so reloading it doesn't send the form again.
static esp_err_t back_to_page(httpd_req_t *req) {
    httpd_resp_set_status(req, "303 See Other");
    httpd_resp_set_hdr(req, "Location", "/");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, NULL, 0);
}

static void put_banners(page_t *p, const net_add_t *add, int saved_count, bool bridge_set) {
    if (add->state == NET_ADD_CHECKING) {
        put(p, "<p class=info role=status><span class=spin aria-hidden=true></span>Checking <b>");
        put_escaped(p, add->ssid);
        put(p, "</b>: the display joins it to check the password, which takes a few seconds. This phone may leave the "
               "setup network for a moment. If it doesn't come back by itself, join <b>");
        put_escaped(p, net_setup_ssid());
        put(p, "</b> again: this page shows the result.</p>");
        put(p, POLL_SCRIPT);
    } else if (add->state == NET_ADD_JOINED) {
        put(p, "<p class=ok>Saved <b>");
        put_escaped(p, add->ssid);
        put(p, "</b>: the display joined it.</p>");
    } else if (add->state == NET_ADD_FAILED) {
        put(p, "<p class=err>Couldn't add <b>");
        put_escaped(p, add->ssid);
        put(p, "</b>: ");
        put_escaped(p, add->problem);
        put(p, ". The saved networks are unchanged.</p>");
    }
    const int why = net_setup_why();
    if (why & NET_WHY_NO_WIFI) {
        put(p, saved_count ? "<p class=err>None of the saved networks could be joined. Add one that is in reach, or "
                             "add it again with its password.</p>"
                           : "<p class=info>Add a Wi-Fi network for the display (2.4 GHz).</p>");
    } else if (why & NET_WHY_NO_BRIDGE) {
        put(p, bridge_set ? "<p class=err>On Wi-Fi, but the bridge can't be reached. Check its address below, or "
                            "add another network.</p>"
                          : "<p class=info>On Wi-Fi. Now type the bridge address below.</p>");
    } else if (why & NET_WHY_ASKED) {
        put(p, "<p class=info>Opened from the admin page. The display stays online, and this setup network closes "
               "by itself after 10 minutes.</p>");
    }
}

static esp_err_t root_get(httpd_req_t *req) {
    net_page_used();
    net_add_t add;
    net_add_result(&add);
    const bool checking = add.state == NET_ADD_CHECKING;
    char query[16] = "";
    if (!checking && httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK && strstr(query, "scan")) {
        net_scan(SCAN_WAIT_MS);
    }
    net_nearby_t nearby[MAX_NEARBY];
    int nearby_count = net_nearby(nearby, MAX_NEARBY);
    if (nearby_count == 0 && !checking) {
        net_scan(SCAN_WAIT_MS);
        nearby_count = net_nearby(nearby, MAX_NEARBY);
    }
    net_saved_t saved[SETTINGS_MAX_NETWORKS];
    const int saved_count = net_saved(saved);
    for (int i = 0; i < nearby_count; i++) {  // as saved now, not at the scan
        nearby[i].saved = false;
        for (int j = 0; j < saved_count; j++) nearby[i].saved |= strcmp(nearby[i].ssid, saved[j].ssid) == 0;
    }
    settings_t s;
    settings_load(&s);

    page_t p = new_page();
    if (!p.buf) return httpd_resp_send_500(req);
    put(&p, "<h1>Desk display setup</h1>");
    put_banners(&p, &add, saved_count, s.bridge_url[0] != '\0');

    // The button says what is happening from the moment it is pressed, until the page shows the check.
    put(&p, "<h2>Add a network</h2><form method=post action=/add "
            "onsubmit=\"var b=this.querySelector('button.go');b.disabled=true;b.textContent='Checking\\u2026'\">"
            "<label for=ssid>Network</label>"
            "<input id=ssid name=ssid maxlength=32 required autocomplete=off autocapitalize=off spellcheck=false>"
            "<div class=nets>");
    for (int i = 0; i < nearby_count; i++) {
        put(&p, "<button type=button data-n=\"");
        put_escaped(&p, nearby[i].ssid);
        put(&p, "\" onclick=\"ssid.value=this.dataset.n;pass.focus()\">");
        put_escaped(&p, nearby[i].ssid);
        if (nearby[i].saved) put(&p, " <small>saved</small>");
        put(&p, "</button>");
    }
    put(&p, "</div><p class=note>");
    if (nearby_count == 0) put(&p, "No networks found. ");
    put(&p, "<a href=\"/?scan=1\">Search again</a> · 2.4 GHz networks only</p>"
            "<label for=pass>Password</label>"
            "<input id=pass name=pass type=password maxlength=63 autocomplete=off>"
            "<button class=go>Add</button><p class=note>The display joins the network first, to check the password. "
            "Saving a network that is saved already changes its password.</p></form>");

    char line[96];
    snprintf(line, sizeof(line), "<h2>Saved networks (%d of %d)</h2>", saved_count, SETTINGS_MAX_NETWORKS);
    put(&p, line);
    if (saved_count == 0) put(&p, "<p class=note>None yet.</p>");
    if (saved_count > 0) put(&p, "<ul>");
    for (int i = 0; i < saved_count; i++) {
        const net_saved_t *n = &saved[i];
        put(&p, "<li><div>");
        put_escaped(&p, n->ssid);
        put(&p, "<br><span class=note>");
        if (n->state == NET_SAVED_IN_USE) {
            snprintf(line, sizeof(line), "In use, signal %s (%d dBm)", signal_word(n->rssi), n->rssi);
        } else if (n->state == NET_SAVED_NEARBY) {
            snprintf(line, sizeof(line), "In reach, signal %s", signal_word(n->rssi));
        } else {
            snprintf(line, sizeof(line), "Not in reach");
        }
        put(&p, line);
        if (n->problem[0]) {
            put(&p, ". Last try: ");
            put_escaped(&p, n->problem);
        }
        put(&p, "</span></div><form method=post action=/forget><input type=hidden name=id value=");
        put_hex(&p, n->ssid);
        put(&p, "><button aria-label=\"Forget ");
        put_escaped(&p, n->ssid);
        put(&p, "\">Forget</button></form></li>");
    }
    if (saved_count > 0) put(&p, "</ul>");

    put(&p, "<h2>Bridge</h2><form method=post action=/bridge><label for=bridge>Bridge address</label>"
            "<input id=bridge name=bridge maxlength=180 required autocomplete=off autocapitalize=off spellcheck=false "
            "placeholder=\"wss://desk.example.com\" value=\"");
    put_escaped(&p, s.bridge_url);
    memset(&s, 0, sizeof(s));  // it holds the device key
    put(&p, "\"><p class=note>Through the tunnel: its name, like <code>desk.example.com</code>, which works from any "
            "network. On the home network only: the computer running the bridge and port 8787, like "
            "<code>192.168.1.20:8787</code>. A new address removes this display's key: approve it again in that "
            "bridge's admin page.</p><button class=go>Save the address</button></form>"
            "<p class=note>When you close this page, a phone may warn that this network has no internet. That is "
            "expected: it is the display's own setup network.</p>");
    return send_page(req, &p);
}

static esp_err_t status_get(httpd_req_t *req) {
    net_page_used();
    net_add_t add;
    net_add_result(&add);
    static const char *const STATES[] = {"", "checking", "joined", "failed"};
    char json[48];
    snprintf(json, sizeof(json), "{\"add\":\"%s\"}", STATES[add.state]);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

static bool read_body(httpd_req_t *req, char *body, size_t size) {
    if (req->content_len >= size) return false;
    size_t got = 0;
    while (got < req->content_len) {
        const int n = httpd_req_recv(req, body + got, req->content_len - got);
        if (n <= 0) return false;
        got += n;
    }
    body[got] = '\0';
    return true;
}

static esp_err_t add_post(httpd_req_t *req) {
    net_page_used();
    char body[BODY_SIZE];
    if (!read_body(req, body, sizeof(body))) return problem_page(req, "That was too long.");
    char ssid[33], pass[65];
    const bool ok = form_field(body, "ssid", ssid, sizeof(ssid)) && form_field(body, "pass", pass, sizeof(pass));
    memset(body, 0, sizeof(body));  // the password
    const size_t pass_len = strlen(pass);
    const char *problem = NULL;
    if (!ok || ssid[0] == '\0') {
        problem = "Choose or type the network's name.";
    } else if (pass_len != 0 && (pass_len < 8 || pass_len > 63)) {
        problem = "A Wi-Fi password has 8 to 63 characters (or none for an open network).";
    } else {
        problem = net_add(ssid, pass);
    }
    memset(pass, 0, sizeof(pass));
    if (problem) return problem_page(req, problem);
    ESP_LOGI(TAG, "checking a network before saving it");
    return back_to_page(req);
}

static esp_err_t forget_post(httpd_req_t *req) {
    net_page_used();
    char body[BODY_SIZE], hex[80], ssid[33];
    if (!read_body(req, body, sizeof(body)) || !form_field(body, "id", hex, sizeof(hex)) || !from_hex(hex, ssid, sizeof(ssid))) {
        return problem_page(req, "That network wasn't recognised.");
    }
    if (!net_forget_network(ssid)) return problem_page(req, "That network isn't saved any more.");
    return back_to_page(req);
}

static esp_err_t bridge_post(httpd_req_t *req) {
    net_page_used();
    char body[BODY_SIZE], typed[192], url[192];
    if (!read_body(req, body, sizeof(body)) || !form_field(body, "bridge", typed, sizeof(typed)) ||
        !portal_bridge_url(typed, url, sizeof(url))) {
        return problem_page(req, "The bridge address doesn't look right. Example: desk.example.com or 192.168.1.20:8787");
    }
    bool changed = false;
    const esp_err_t err = settings_save_bridge(url, &changed);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "saving the bridge address failed: %s", esp_err_to_name(err));
        return problem_page(req, "The address could not be saved. Try again.");
    }
    if (!changed) return back_to_page(req);
    ESP_LOGI(TAG, "new bridge address saved");
    net_bridge_saved();
    return message_page(req, "<h1>Saved</h1><p>The display connects to this bridge now (restarting first if it was "
                             "connected to another one), and waits there for approval: approve it in that bridge's "
                             "admin page.</p><p><a href=/>Back to setup</a></p>");
}

// Every other address leads to the setup page; this is also what makes phones notice it.
static esp_err_t redirect(httpd_req_t *req, httpd_err_code_t err) {
    (void)err;
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", root_url);
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, "Desk display setup", HTTPD_RESP_USE_STRLEN);  // iOS wants a body
}

esp_err_t portal_start(uint32_t ip) {
    if (server) return ESP_OK;
    portal_ip = ip;
    struct in_addr a = {.s_addr = ip};
    snprintf(root_url, sizeof(root_url), "http://%s/", inet_ntoa(a));

    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.stack_size = 8192;
    cfg.max_open_sockets = 7;
    cfg.lru_purge_enable = true;
    esp_err_t err = httpd_start(&server, &cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "web server could not start: %s", esp_err_to_name(err));
        return err;
    }
    static const httpd_uri_t routes[] = {
        {.uri = "/", .method = HTTP_GET, .handler = root_get},
        {.uri = "/status", .method = HTTP_GET, .handler = status_get},
        {.uri = "/add", .method = HTTP_POST, .handler = add_post},
        {.uri = "/forget", .method = HTTP_POST, .handler = forget_post},
        {.uri = "/bridge", .method = HTTP_POST, .handler = bridge_post},
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) httpd_register_uri_handler(server, &routes[i]);
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
