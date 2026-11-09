#include "face.h"

#include <math.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

#include "board.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"

static const char *TAG = "face";

// Geometry, in pixels on the 412 x 412 panel.
#define BODY 300          // the avatar image, square
#define EYE_W 30
#define EYE_H 68
#define EYE_GAP 44        // from the centre to each eye
#define RING 396          // diameter of the status ring
#define RING_WIDTH 8
#define ORBIT_R 176       // radius the thinking / working dots travel on
#define DOT 14
#define DOTS 3
#define FRAME_MS 33

static const char *STATE_NAMES[FACE_STATE_COUNT] = {
    "idle", "listening", "thinking", "working", "waiting", "speaking", "error", "offline",
};
static const char *SHAPE_NAMES[FACE_SHAPE_COUNT] = {"blob", "teardrop", "cloud", "hex", "squircle", "circle"};

// Where the eyes sit on each shape (fraction of the body radius, down is positive).
static const float EYE_Y[FACE_SHAPE_COUNT] = {-0.04f, 0.16f, 0.04f, -0.02f, -0.04f, -0.04f};

static lv_obj_t *body;
static lv_image_dsc_t body_dsc;
static uint16_t *body_pixels;
static lv_obj_t *eyes[2];
static lv_obj_t *ring;
static lv_obj_t *dots[DOTS];
static lv_obj_t *root;

// The setup screen.
static lv_obj_t *setup_screen;
static lv_obj_t *setup_qr;
static lv_obj_t *setup_ssid;
static lv_obj_t *setup_password;

static face_shape_t shape = FACE_BLOB;
static uint32_t color = 0xf59e0b;
static atomic_int state = FACE_IDLE;
static int64_t state_since_ms;
static atomic_int level_milli;  // 0..1000
static int64_t next_blink_ms;
static int64_t poke_ms = INT64_MIN / 2;

// ---- the body: signed distance to each shape's outline, rasterised once with smooth edges ----

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

static float sd_circle(float x, float y, float r) { return sqrtf(x * x + y * y) - r; }

static float sd_round_box(float x, float y, float bx, float by, float r) {
    const float qx = fabsf(x) - bx + r, qy = fabsf(y) - by + r;
    const float ox = fmaxf(qx, 0), oy = fmaxf(qy, 0);
    return sqrtf(ox * ox + oy * oy) + fminf(fmaxf(qx, qy), 0) - r;
}

// Regular hexagon with flat top and bottom, apothem r.
static float sd_hexagon(float x, float y, float r) {
    const float kx = -0.866025404f, ky = 0.5f, kz = 0.577350269f;
    x = fabsf(x);
    y = fabsf(y);
    const float d = 2.0f * fminf(kx * x + ky * y, 0.0f);
    x -= d * kx;
    y -= d * ky;
    x -= clampf(x, -kz * r, kz * r);
    y -= r;
    return sqrtf(x * x + y * y) * (y > 0 ? 1.0f : -1.0f);
}

// Two circles joined by tangents: radius r1 at the origin, r2 at height h (y up).
static float sd_uneven_capsule(float x, float y, float r1, float r2, float h) {
    x = fabsf(x);
    const float b = (r1 - r2) / h, a = sqrtf(1 - b * b);
    const float k = -b * x + a * y;
    if (k < 0) return sqrtf(x * x + y * y) - r1;
    if (k > a * h) return sqrtf(x * x + (y - h) * (y - h)) - r2;
    return a * x + b * y - r1;
}

static float smooth_min(float a, float b, float k) {
    const float h = clampf(0.5f + 0.5f * (b - a) / k, 0, 1);
    return b + (a - b) * h - k * h * (1 - h);
}

// Distance from (x, y), relative to the centre with y down, to the outline of a shape filling radius R.
static float shape_distance(face_shape_t s, float x, float y, float R) {
    switch (s) {
        case FACE_TEARDROP:  // round bottom, point up
            return sd_uneven_capsule(x, -(y - 0.2f * R), 0.78f * R, 0.12f * R, 1.02f * R);
        case FACE_CLOUD: {
            float d = sd_round_box(x, y - 0.36f * R, 0.86f * R, 0.32f * R, 0.32f * R);
            d = smooth_min(d, sd_circle(x + 0.44f * R, y - 0.12f * R, 0.42f * R), 0.08f * R);
            d = smooth_min(d, sd_circle(x - 0.02f * R, y + 0.16f * R, 0.56f * R), 0.08f * R);
            d = smooth_min(d, sd_circle(x - 0.47f * R, y - 0.10f * R, 0.40f * R), 0.08f * R);
            return d;
        }
        case FACE_HEX: {
            const float rounding = 0.14f * R;
            return sd_hexagon(x, y, 0.84f * R - rounding) - rounding;
        }
        case FACE_SQUIRCLE: {
            const float x2 = x * x, y2 = y * y;
            return powf(x2 * x2 + y2 * y2, 0.25f) - 0.9f * R;
        }
        case FACE_CIRCLE:
            return sd_circle(x, y, 0.92f * R);
        case FACE_BLOB:
        default: {
            const float t = atan2f(y, x);
            const float r = 0.9f * R * (1 + 0.045f * sinf(3 * t + 0.6f) + 0.03f * sinf(5 * t + 1.9f));
            return sqrtf(x * x + y * y) - r;
        }
    }
}

static uint16_t rgb565(uint32_t rgb, float k) {
    const uint32_t r = (uint32_t)(((rgb >> 16) & 0xff) * k), g = (uint32_t)(((rgb >> 8) & 0xff) * k),
                   b = (uint32_t)((rgb & 0xff) * k);
    return (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

static void render_body(void) {
    const float R = BODY / 2.0f;
    for (int py = 0; py < BODY; py++) {
        for (int px = 0; px < BODY; px++) {
            const float d = shape_distance(shape, px - R + 0.5f, py - R + 0.5f, R);
            body_pixels[py * BODY + px] = rgb565(color, clampf(0.5f - d, 0, 1));  // over a black screen
        }
    }
    lv_obj_invalidate(body);  // LVGL draws the image straight from body_pixels (its image cache is off)
}

// ---- colours ----

static float luminance(uint32_t rgb) {
    return (0.2126f * ((rgb >> 16) & 0xff) + 0.7152f * ((rgb >> 8) & 0xff) + 0.0722f * (rgb & 0xff)) / 255.0f;
}

static lv_color_t accent(void) {  // the ring and dots: the body colour, lightened
    const uint32_t r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    return lv_color_make(r + (255 - r) * 35 / 100, g + (255 - g) * 35 / 100, b + (255 - b) * 35 / 100);
}

static void apply_colors(void) {
    const lv_color_t eye = luminance(color) > 0.6f ? lv_color_hex(0x1f2937) : lv_color_white();
    for (int i = 0; i < 2; i++) lv_obj_set_style_bg_color(eyes[i], eye, 0);
    for (int i = 0; i < DOTS; i++) lv_obj_set_style_bg_color(dots[i], accent(), 0);
}

// ---- animation ----

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static float level(void) { return atomic_load(&level_milli) / 1000.0f; }

// 1 while the eyes are open, dipping towards 0 during a blink.
static float blink(int64_t t) {
    if (t >= next_blink_ms + 160) next_blink_ms = t + 2500 + (int64_t)(esp_random() % 3500);
    if (t < next_blink_ms) return 1;
    const float phase = (t - next_blink_ms) / 160.0f;  // 0..1
    return 0.08f + 0.92f * fabsf(1 - 2 * phase);
}

static void show(lv_obj_t *obj, bool visible) {
    if (visible == !lv_obj_is_hidden(obj)) return;
    lv_obj_set_hidden(obj, !visible);
}

static void set_ring(lv_color_t c, lv_opa_t opa, int16_t degrees, int32_t width) {
    lv_obj_set_style_arc_color(ring, c, LV_PART_INDICATOR);
    lv_obj_set_style_arc_opa(ring, opa, LV_PART_INDICATOR);
    lv_obj_set_style_arc_width(ring, width, LV_PART_INDICATOR);
    lv_arc_set_angles(ring, 0, degrees);
}

static void tick(lv_timer_t *timer) {
    (void)timer;
    const int64_t t = now_ms();
    const face_state_t s = (face_state_t)atomic_load(&state);
    const int64_t since = t - state_since_ms;
    // The audio level (0..1), smoothed so the ring swells quickly with a voice and fades more slowly.
    static float lv;
    const float target = level();
    lv += (target - lv) * (target > lv ? 0.5f : 0.12f);

    float gx = 0, gy = 0, open = blink(t), wide = 1;
    bool ring_on = false, dots_on = false;
    float orbit_period = 0;

    switch (s) {
        case FACE_IDLE:
            gx = 8 * sinf(t / 1700.0f) + 4 * sinf(t / 730.0f);
            gy = 5 * sinf(t / 1300.0f);
            break;
        case FACE_LISTENING:
            wide = 1.12f;
            gy = -2 * lv;
            ring_on = true;
            set_ring(accent(), (lv_opa_t)(90 + 165 * lv), 360, (int32_t)(4 + 20 * lv));
            break;
        case FACE_THINKING:
            gx = 10;
            gy = -14;
            dots_on = true;
            orbit_period = 2400;
            break;
        case FACE_WORKING:
            gx = 14 * tanhf(4 * sinf(t / 320.0f));
            gy = -4;
            dots_on = true;
            orbit_period = 900;
            break;
        case FACE_WAITING:
            ring_on = true;
            set_ring(accent(), (lv_opa_t)(150 + 105 * sinf(t / 260.0f)), 360, RING_WIDTH);
            break;
        case FACE_SPEAKING:
            gy = -6 * lv;
            wide = 1 + 0.08f * lv;
            ring_on = true;
            set_ring(accent(), (lv_opa_t)(60 + 195 * lv), 360, (int32_t)(4 + 14 * lv));
            break;
        case FACE_ERROR:
            open *= 0.45f;
            if (since < 600) gx = 10 * sinf(since / 30.0f) * (1 - since / 600.0f);
            ring_on = true;
            set_ring(lv_color_hex(0xef4444), LV_OPA_COVER, 360, RING_WIDTH);
            break;
        case FACE_OFFLINE:
            open = 0.08f;
            break;
        default:
            break;
    }

    // A poke: a quick squint and a wobble that dies away.
    const int64_t since_poke = t - poke_ms;
    if (since_poke >= 0 && since_poke < 500) {
        gx += 9 * sinf(since_poke / 45.0f) * (1 - since_poke / 500.0f);
        if (since_poke < 140) open = fminf(open, 0.35f);
    }

    show(ring, ring_on);
    for (int i = 0; i < DOTS; i++) show(dots[i], dots_on);
    if (dots_on) {
        const float base = (float)(2 * M_PI) * (float)(t % (int64_t)orbit_period) / orbit_period;
        for (int i = 0; i < DOTS; i++) {
            const float a = base - i * 0.42f;
            lv_obj_align(dots[i], LV_ALIGN_CENTER, (int32_t)(ORBIT_R * cosf(a)), (int32_t)(ORBIT_R * sinf(a)));
            lv_obj_set_style_bg_opa(dots[i], (lv_opa_t)(255 - i * 70), 0);
        }
    }

    const int32_t h = (int32_t)fmaxf(6, EYE_H * wide * open);
    const int32_t w = (int32_t)(EYE_W * wide);
    const int32_t ey = (int32_t)(EYE_Y[shape] * BODY / 2 + gy);
    for (int i = 0; i < 2; i++) {
        lv_obj_set_size(eyes[i], w, h);
        lv_obj_align(eyes[i], LV_ALIGN_CENTER, (int32_t)((i ? EYE_GAP : -EYE_GAP) + gx), ey);
    }
}

// ---- public ----

void face_create(lv_obj_t *screen) {
    root = screen;
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_set_scrollable(screen, false);

    body_pixels = heap_caps_malloc(BODY * BODY * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
    if (!body_pixels) {
        ESP_LOGE(TAG, "no memory for the avatar image");
        return;
    }
    memset(&body_dsc, 0, sizeof(body_dsc));
    body_dsc.header.magic = LV_IMAGE_HEADER_MAGIC;
    body_dsc.header.cf = LV_COLOR_FORMAT_RGB565;
    body_dsc.header.w = BODY;
    body_dsc.header.h = BODY;
    body_dsc.header.stride = BODY * sizeof(uint16_t);
    body_dsc.data_size = BODY * BODY * sizeof(uint16_t);
    body_dsc.data = (const uint8_t *)body_pixels;

    ring = lv_arc_create(screen);
    lv_obj_set_size(ring, RING, RING);
    lv_obj_center(ring);
    lv_obj_remove_style(ring, NULL, LV_PART_KNOB);
    lv_obj_set_clickable(ring, false);
    lv_obj_set_style_arc_opa(ring, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_arc_width(ring, RING_WIDTH, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(ring, true, LV_PART_INDICATOR);
    lv_arc_set_bg_angles(ring, 0, 360);
    lv_arc_set_rotation(ring, 270);  // start at the top

    body = lv_image_create(screen);
    lv_image_set_src(body, &body_dsc);
    lv_obj_center(body);
    lv_obj_set_clickable(body, false);

    for (int i = 0; i < 2; i++) {
        eyes[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(eyes[i]);
        lv_obj_set_style_bg_opa(eyes[i], LV_OPA_COVER, 0);
        lv_obj_set_style_radius(eyes[i], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_clickable(eyes[i], false);
    }
    for (int i = 0; i < DOTS; i++) {
        dots[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(dots[i]);
        lv_obj_set_size(dots[i], DOT, DOT);
        lv_obj_set_style_bg_opa(dots[i], LV_OPA_COVER, 0);
        lv_obj_set_style_radius(dots[i], LV_RADIUS_CIRCLE, 0);
        lv_obj_set_clickable(dots[i], false);
    }

    render_body();
    apply_colors();
    state_since_ms = now_ms();
    next_blink_ms = state_since_ms + 2000;
    tick(NULL);
    lv_timer_create(tick, FRAME_MS, NULL);
}

void face_set_avatar(face_shape_t new_shape, uint32_t rgb) {
    shape = new_shape < FACE_SHAPE_COUNT ? new_shape : FACE_BLOB;
    color = rgb & 0xffffff;
    if (!body_pixels) return;
    render_body();
    apply_colors();
}

void face_set_state(face_state_t new_state) {
    if (new_state >= FACE_STATE_COUNT) return;
    atomic_store(&state, new_state);
    state_since_ms = now_ms();
    if (body) lv_obj_set_style_image_opa(body, new_state == FACE_OFFLINE ? 90 : LV_OPA_COVER, 0);
}

face_state_t face_get_state(void) { return (face_state_t)atomic_load(&state); }

face_shape_t face_get_shape(void) { return shape; }

uint32_t face_get_color(void) { return color; }

void face_poke(void) { poke_ms = now_ms(); }

static lv_obj_t *setup_label(int32_t y, lv_color_t c) {
    lv_obj_t *label = lv_label_create(setup_screen);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(label, c, 0);
    lv_obj_align(label, LV_ALIGN_CENTER, 0, y);
    return label;
}

void face_show_setup(const char *ssid, const char *password) {
    if (!setup_screen) {
        // Laid out for the round panel: everything stays inside the circle.
        setup_screen = lv_obj_create(root);
        lv_obj_remove_style_all(setup_screen);
        lv_obj_set_size(setup_screen, LV_PCT(100), LV_PCT(100));
        lv_obj_set_style_bg_color(setup_screen, lv_color_black(), 0);
        lv_obj_set_style_bg_opa(setup_screen, LV_OPA_COVER, 0);
        lv_obj_set_clickable(setup_screen, false);
        lv_label_set_text(setup_label(-146, lv_color_hex(0xfbbf24)), "Wi-Fi setup");
        setup_qr = lv_qrcode_create(setup_screen);
        lv_qrcode_set_size(setup_qr, 176);
        lv_qrcode_set_dark_color(setup_qr, lv_color_black());
        lv_qrcode_set_light_color(setup_qr, lv_color_white());
        lv_qrcode_set_quiet_zone(setup_qr, true);
        lv_obj_align(setup_qr, LV_ALIGN_CENTER, 0, -14);
        setup_ssid = setup_label(104, lv_color_white());
        setup_password = setup_label(138, lv_color_hex(0xd1d5db));
    }
    // The standard Wi-Fi QR format: a phone camera offers to join the network.
    char qr[96];
    snprintf(qr, sizeof(qr), "WIFI:T:WPA;S:%s;P:%s;;", ssid, password);
    lv_qrcode_update(setup_qr, qr, strlen(qr));
    lv_label_set_text(setup_ssid, ssid);
    lv_label_set_text_fmt(setup_password, "Password %s", password);
    lv_obj_move_foreground(setup_screen);
    show(setup_screen, true);
}

void face_hide_setup(void) {
    if (setup_screen) show(setup_screen, false);
}

face_shape_t face_shape_from_name(const char *name) {
    for (int i = 0; i < FACE_SHAPE_COUNT; i++) {
        if (strcmp(name, SHAPE_NAMES[i]) == 0) return (face_shape_t)i;
    }
    return FACE_SHAPE_COUNT;
}

void face_set_level(float value) { atomic_store(&level_milli, (int)(clampf(value, 0, 1) * 1000)); }

const char *face_state_name(face_state_t s) { return s < FACE_STATE_COUNT ? STATE_NAMES[s] : "?"; }

const char *face_shape_name(face_shape_t s) { return s < FACE_SHAPE_COUNT ? SHAPE_NAMES[s] : "?"; }
