// grok-puck: the CURRENT source of the LCD-1.46 slim case and its button plungers.
//   part = "case"        -> ../print/lcd146_case.stl
//   part = "button_pair" -> ../print/lcd146_button_plungers.stl
//   part = "gauge"       -> the optional glass fit gauge (../print/lcd146_glass_fit_gauge.stl
//                           was exported from the v1 source; the gauge code is the same here).
// The stand is NOT built from this file: build it from esp32s3_lcd146_slim_v1_stand.scad
// (part = "stand"; the listing below calls that source esp32s3_lcd146_slim_scad.pdf and the
// stand lcd146_slim_stand.stl). This file's stand() is a tilted 25/30 deg option, not tested.
// Rebuilt from a verbatim listing; the only change below is a name taken out of five comments.

// =====================================================================
//  SLIM case for the Waveshare ESP32-S3-Touch-LCD-1.46 (cover-glass version)
//
//  CURRENT WORKING SET (printed and confirmed on the board, 2026-11-19):
//    part = "case"         -> the v2 case (pwr_ang 37.5, the default here)
//    part = "button_pair"  -> the v5 plungers, nub_len 1.0 (the default here)
//    stand: the ORIGINAL 15 deg stand, lcd146_slim_stand.stl, made from the v1
//           source (esp32s3_lcd146_slim_scad.pdf). This file's stand() is the
//           tilted 25/30 deg option, which wasn't chosen.
//  Only revisit the PWR window with a new board (this board's PWR switch is
//  probably damaged); v7's 35.6 deg is an untested option.
//
//  v4, 2026-11-13: case = the v2 case (no TF window, 6.0 mm button windows).
//  v6, 2026-11-18: board heights from caliper measurements ([MEAS]).
//  The only change to the printed case is the PWR window. v6 moved it from 37.5
//  to 31.9 deg (2.4 mm toward BOOT at the outside of the case): a print showed
//  this was too far and the v2 position looked better.
//  v7, 2026-11-18: PWR window at 35.6 deg, 0.8 mm toward BOOT from v2 (a third
//  of the v6 move). Everything else is the v2 case exactly; the measured,
//  shorter stack (10.6) means the glass sits 0.4 mm below the rim
//  (top_d = -0.4), as it already does in the v2 case.
//  v5, 2026-11-13: plungers keep the full 7.4 mm flat inner face of v3 and reach
//  further in: on the real board the switches sit further in than the drawing
//  showed, so earlier plungers slid in without clicking and didn't spring back.
//  Plungers come in 4 lengths (inner face 1.0 / 1.5 / 2.0 / 2.5 mm further in).
//  Stand: the whole v1 cradle is tilted back by (lean - 15), so the puck sits
//  as deep in it as in the v1 stand.
//
//  The board screws straight into the back plate through its own three
//  brass M2 standoffs. No front bezel, no screw lugs: the wall rises flush
//  with the glass. 48.5 mm across, 13.4 mm thick.
//
//  Parts:
//    case        one piece: back plate + wall
//    button_set  plungers for the side PWR / BOOT switches, at three switch gaps
//    gauge       four quick rings to find the glass clearance (print first)
//    stand       separate desk stand (20 / 25 / 30 deg lean, see `lean`), for a 90-degree "up/down
//                angle" USB-C cable (cable bends toward the back of the puck,
//                not sideways).
//    3 x M2x4 button-head machine screws (M2 x 0.4 thread, not self-tapping).
//        NOTHING LONGER THAN 4 mm: an M2x4 ends about 1 mm short of the PCB;
//        longer screws can reach the board.
//
//  Assembly: case face-up on the desk -> drop each plunger in from the inside,
//  push its cap out through its window -> lower the board in, screen up, USB-C
//  into the bottom notch -> hold the board, turn it over -> 3 screws, snug only.
//
//  Printing (P2S, PLA, 0.20mm Standard, no supports, all as exported):
//    case (back face down), then button_pair (nub_len 1.0 is the length that works).
//    Tip: print the plungers in a contrasting colour so the buttons are easy to find.
//    stand: base down, 40% infill or more - the weight keeps it from tipping
//    back when you tap the top of the screen (~72 gf at 40%, ~98 gf at 100%).
//  Docking: plug the cable in with the cable pointing back, lower the puck into
//    the stand so the plug drops into the slot, lay the cable in the tunnel.
//
//  FRAME: origin = centre of the board on the glass front face. Looking at the
//  screen with USB-C at the bottom: +X right, +Y up, +Z toward you. Depth d is
//  measured from the glass front face going back (d = -Z). Angles CCW from +X.
//
//  SOURCES  [MEAS] measured with calipers on the real board (2026-11-18)
//           [DWG] Waveshare dimension drawing (datasheet, not measured)
//           [IMG] scaled off that drawing's photo, ~10.6 px/mm, about +/-0.5 mm
// =====================================================================

/* [What to build] */
part = "docked"; // [case, button_set, gauge, stand, docked, assembly, exploded, board]

/* [Fit - tune after the gauge] */
glass_clr = 0.25;  // radial gap around the glass (gauge: 0.15 / 0.25 / 0.35 / 0.50)
btn_gap   = 0.35;  // plunger face to switch tip at rest
btn_slide = 0.20;  // plunger clearance in its window, per side

/* [Board - Waveshare drawing] */
glass_d     = 44.77; // [DWG]
stack_body  = 10.6;  // [MEAS] glass front -> back of brass standoffs (drawing: 11.00)
stack_pins  = 11.8;  // [MEAS] glass front -> header pin tips (drawing: 12.30)
pcb_front_d = 6.1;   //        PCB front (estimate: measured back face minus ~1.1 mm board)
pcb_back_d  = 7.2;   // [MEAS] glass front -> PCB back face near the edge (drawing photo: 7.53)
pcb_d       = 41.33; // [DWG]
holes = [[0, 18.85], [11.77, -13.85], [-11.77, -13.85]]; // [DWG 23.54 / 32.70 + IMG] standoffs
btn_tip_r   = 20.6;  // [IMG] PWR / BOOT plunger tips
btn_d       = 8.2;   // [MEAS] glass front -> centre of the PWR push part (estimate was 9.0)
pwr_ang     = 37.5;  // CURRENT = v2 (works with this board). v6: 31.9 (too far toward BOOT);
                     // v7: 35.6 (untested option for a new board).
                     // G (21.4) was measured at the base of the buttons, not the push parts, so it
                     // can't place PWR; re-measure push-part centres on a new board.
boot_ang    = -33;   // [IMG] confirmed: the BOOT plunger lines up and works
tf_ang      = 3;     // [IMG] TF slot, right side, under the display
tf_d0       = 4.3;
tf_d1       = 6.25;
usb_mouth_r = 21.75; // [DWG 42.58]
usb_d       = 9.06;  // [IMG]
usb_w       = 8.94;
usb_h       = 2.75;
spk     = [12.04, 1.27];  spk_size = [11.8, 9.9];
mic     = [-14.86, -10.52];
led_chg = [6.86, -18.54];
led_pwr = [-7.20, -18.77];
trim    = [8.27, -10.05];
hdr     = [-15.30, 1.00]; hdr_size = [4.7, 12.7];
bat     = [6.90, 15.40];

/* [Case] */
wall        = 1.6;   // side wall (4 perimeters)
plate_t     = 2.0;   // back plate
pad_h       = 0.4;   // pads under the standoffs
pad_d       = 5.0;
pin_clr     = 0.4;   // header pin tips to the bottom of their pocket
top_d       = -0.4;  // wall top relative to the glass front (0 = flush, + = wall sits lower,
                     // - = rim stands above the glass). -0.4 reproduces the v2 case with the
                     // measured 10.6 mm stack; set 0 (and btn_win_d0 7.2) for a flush rim.
screw_hole  = 2.6;   // a little loose: the drawing gives the hole spacing exactly but the
                     // pattern's position on the board only to ~0.3 mm
head_d      = 4.4;   // counterbore for the button head
head_h      = 0.9;   // keeps the M2x4 engagement at ~2.5 mm, ~1 mm short of the PCB
usb_open_w  = 13.5;  // plug overmold, not just the metal shell
usb_open_h  = 8.8;   // 8.0 in v1-v5; 8.8 keeps the v2 opening edge in the same place now that
                     // the measured board sits 0.4 mm deeper (the tested cable fits it)
btn_win_w   = 6.0;   // plunger window width in the case (v2 case)
btn_win_d0  = 6.8;   // front edge of the plunger windows (depth below the glass; 7.2 below the rim)
btn_fl_w    = 7.4;   // inner flange that keeps the plunger in
btn_proud   = 1.5;   // cap stands this far out of the wall (v1: 0.6 - too little travel)
cap_round   = 0.6;   // rounding on the cap's outer corners
btn_side_gap = 0.3;  // cap to window, each side (cap 5.4 wide in the 6.0 window)
btn_vert_gap = 0.4;  // plunger to window, top and bottom (plunger 3.4 tall in 4.2)
nub_w       = 7.4;   // width of the inner face that pushes the switch (full flange width;
                     // v4's 2.4 mm nub was too narrow and missed the switch)
nub_len     = 1.0;   // how far the inner face reaches past the v3 plunger's inner face
tf_window   = false; // TF card window (v1: open; not needed for this project)
tf_open_w   = 13.0;
tf_flare    = 1.5;
grille_hole = 1.5;
grille_pitch= 2.4;
mic_hole    = 1.6;
led_hole    = 1.8;
trim_hole   = true;  // hole over the speaker-volume trimmer
trim_hole_d = 3.2;

$fn = 96;
eps = 0.01;

// ---------- derived ----------
bore_r   = glass_d/2 + glass_clr;
outer_r  = bore_r + wall;
face_d   = stack_body + pad_h;        // depth of the plate's inner face
back_d   = face_d + plate_t;          // depth of the back face = overall thickness
pl_d0    = btn_win_d0 + btn_vert_gap;
pl_d1    = face_d - btn_vert_gap;
function zd(d) = -d;

// =====================================================================
//  CASE
// =====================================================================
module case() {
  ch = 0.6;
  difference() {
    union() {
      translate([0, 0, zd(back_d)]) cylinder(r1 = outer_r - ch, r2 = outer_r, h = ch);
      translate([0, 0, zd(back_d) + ch]) cylinder(r = outer_r, h = back_d - top_d - 2*ch);
      translate([0, 0, zd(top_d) - ch]) cylinder(r1 = outer_r, r2 = outer_r - ch, h = ch);
      for (h = holes) translate([h.x, h.y, zd(face_d) - eps]) cylinder(d = pad_d, h = pad_h + eps);
    }
    // glass bore with a small lead-in at the top
    difference() {
      translate([0, 0, zd(face_d)]) cylinder(r = bore_r, h = face_d + 1);
      for (h = holes) translate([h.x, h.y, zd(face_d) - 1]) cylinder(d = pad_d, h = pad_h + 1);
    }
    translate([0, 0, zd(top_d) - 0.5]) cylinder(r1 = bore_r, r2 = bore_r + 0.5 + eps, h = 0.5 + eps);
    // screws into the standoffs, counterbored from the back
    for (h = holes) translate([h.x, h.y, zd(back_d) - 1]) {
      cylinder(d = screw_hole, h = back_d, $fn = 32);
      cylinder(d = head_d, h = head_h + 1, $fn = 48);
    }
    usb_cut();
    for (a = [pwr_ang, boot_ang]) btn_window(a);
    if (tf_window) tf_cut();
    // header: pocket for the pin tips, closed at the back
    translate([hdr.x, hdr.y, zd(stack_pins + pin_clr)])
      linear_extrude(stack_pins + pin_clr - face_d + 1) square([hdr_size.x + 1.5, hdr_size.y + 1.5], center = true);
    // speaker grille
    for (i = [-4:4], j = [-4:4]) {
      p = [i*grille_pitch + (j % 2 == 0 ? 0 : grille_pitch/2), j*grille_pitch*0.866];
      if (pow(p.x/((spk_size.x - 1.4)/2), 2) + pow(p.y/((spk_size.y - 1.4)/2), 2) <= 1)
        translate([spk.x + p.x, spk.y + p.y, zd(back_d) - 1]) cylinder(d = grille_hole, h = plate_t + 2, $fn = 16);
    }
    for (p = [[mic, mic_hole], [led_chg, led_hole], [led_pwr, led_hole]])
      translate([p[0].x, p[0].y, zd(back_d) - 1]) cylinder(d = p[1], h = plate_t + 2, $fn = 24);
    if (trim_hole) translate([trim.x, trim.y, zd(back_d) - 1]) cylinder(d = trim_hole_d, h = plate_t + 2, $fn = 32);
  }
}

// USB-C: opening for the plug overmold, through the wall and the plate edge
module usb_cut() {
  d0 = usb_d - usb_open_h/2;
  r  = 1.5;
  translate([0, -usb_mouth_r, 0]) rotate([90, 0, 0]) linear_extrude(10)
    hull() {
      for (s = [-1, 1]) translate([s*(usb_open_w/2 - r), zd(d0) - r]) circle(r = r, $fn = 32);
      translate([-usb_open_w/2, zd(back_d) - 2]) square([usb_open_w, 1]);
    }
}

// plunger window: closed above, floor = the plate's inner face
module btn_window(a) {
  rotate(a) translate([bore_r - 1, -btn_win_w/2, zd(face_d) - eps])
    cube([wall + 2, btn_win_w, face_d - btn_win_d0 + eps]);
}

module tf_cut() {
  dc = (tf_d0 + tf_d1)/2;
  hgt = (tf_d1 - tf_d0) + 0.9;
  rotate(tf_ang) hull() {
    translate([bore_r - 0.5, -tf_open_w/2, zd(dc) - hgt/2]) cube([eps, tf_open_w, hgt]);
    translate([outer_r + 0.3, -(tf_open_w/2 + tf_flare), zd(dc) - hgt/2 - tf_flare])
      cube([eps, tf_open_w + 2*tf_flare, hgt + 2*tf_flare]);
  }
}

// =====================================================================
//  BUTTON PLUNGERS - push direction along +X; the flange stays inside
// =====================================================================
// the standoff pad nearest BOOT, in the plunger's own frame (both corners notched,
// so the two plungers stay identical)
pad_rr = norm(holes[1]);
pad_da = boot_ang - atan2(holes[1].y, holes[1].x);
module plunger2d(gap = btn_gap, nub = nub_len) {
  cap_w = btn_win_w - 2*btn_side_gap;
  in_r  = btn_tip_r + gap;
  union() {
    translate([in_r - nub, -nub_w/2]) square([nub + 0.01, nub_w]);   // reaches the switch
    intersection() {
      translate([in_r, -btn_fl_w/2]) square([bore_r - in_r + 1, btn_fl_w]);
      circle(r = bore_r - 0.05, $fn = 192);
    }
    translate([bore_r - 0.8, -cap_w/2])
      offset(r = cap_round, $fn = 24) offset(delta = -cap_round)
        square([outer_r + btn_proud - (bore_r - 0.8), cap_w]);
  }
}
// notch for the 0.4 mm standoff pad, stretched 2.5 mm along the push
module pad_notch2d() {
  for (sg = [-1, 1]) hull() for (t = [0, 2.5]) translate([pad_rr*cos(pad_da) + t, sg*pad_rr*sin(pad_da)]) circle(d = pad_d + 1.0, $fn = 48);
}
// 3D plunger in its own frame (push along -X, z = 0 on the back-plate side);
// the notch is cut only in the bottom and top 0.6 mm, so the flange keeps its full width
module plunger3d() {
  h = pl_d1 - pl_d0;
  difference() {
    linear_extrude(h) plunger2d();
    for (z0 = [-0.01, h - (pad_h + 0.2)]) translate([0, 0, z0]) linear_extrude(pad_h + 0.21) pad_notch2d();
  }
}
module plunger_placed(a, gap = btn_gap) {
  rotate(a) translate([0, 0, zd(pl_d1)]) plunger3d();
}
// One pair (PWR + BOOT) per file, at the nub length set by `nub_len`.
// Exported as 4 files: nub 1.0 / 1.5 / 2.0 / 2.5 mm.
module button_pair_print() {
  for (i = [0, 1]) translate([0, i*11, 0])
    translate([-(btn_tip_r + btn_gap - nub_len), 0, 0]) plunger3d();
}

// =====================================================================
//  SIMPLIFIED BOARD (previews and interference checks only)
// =====================================================================
module board() {
  color([0.08, 0.08, 0.08]) translate([0, 0, -2.0]) cylinder(d = glass_d, h = 2.0);
  color("silver") translate([0, 0, zd(pcb_front_d)]) cylinder(d = 40.2, h = pcb_front_d - 2.0);
  color([0.1, 0.3, 0.6]) translate([0, 0, zd(pcb_back_d)]) cylinder(d = pcb_d, h = pcb_back_d - pcb_front_d);
  color("gold") for (h = holes) translate([h.x, h.y, zd(stack_body)])
    difference() { cylinder(d = 3.5, h = stack_body - pcb_back_d, $fn = 6); cylinder(d = 1.6, h = 10, center = true, $fn = 16); }
  color([0.15, 0.15, 0.15]) translate([hdr.x - hdr_size.x/2, hdr.y - hdr_size.y/2, zd(9.66)])
    cube([hdr_size.x, hdr_size.y, 9.66 - pcb_back_d]);
  color("gold") for (i = [0:9], j = [0:1])
    translate([hdr.x + (j - 0.5)*1.27, hdr.y + (i - 4.5)*1.27, zd(stack_pins)]) cylinder(d = 0.4, h = stack_pins - 9.66, $fn = 8);
  color("silver") translate([-usb_w/2, -usb_mouth_r, zd(usb_d + usb_h/2)]) cube([usb_w, 7.35, usb_h]);
  for (a = [pwr_ang, boot_ang]) rotate(a) {
    color("white") translate([btn_tip_r - 5.5, -1.6, zd(10.9)]) cube([4.0, 3.2, 10.9 - pcb_back_d]);
    color("gray")  translate([btn_tip_r - 1.6, -0.8, zd(btn_d) - 0.7]) cube([1.6, 1.6, 1.4]);
  }
  color([0.1, 0.1, 0.1]) rotate(tf_ang) translate([btn_tip_r - 12, -7, zd(tf_d1)]) cube([12 - 0.2, 14, tf_d1 - tf_d0]);
  color("tan") translate([spk.x - spk_size.x/2, spk.y - spk_size.y/2, zd(9.5)]) cube([spk_size.x, spk_size.y, 9.5 - pcb_back_d]);
  color("white") translate([bat.x - 3.0, bat.y - 2.2, zd(11.0)]) cube([6.0, 4.4, 11.0 - pcb_back_d]);
}
// screws as installed (M2x4: head in the counterbore, 4 mm shank)
module screws() {
  for (h = holes) translate([h.x, h.y, zd(back_d - head_h)]) {
    color("silver") cylinder(d = 2.0, h = 4, $fn = 16);
    color("silver") translate([0, 0, -1.1]) cylinder(d = 3.5, h = 1.1, $fn = 24);
  }
}

// =====================================================================
//  FIT GAUGE - four rings, lip down; dots on top = ring number
//    1 dot = 0.15   2 = 0.25 (default)   3 = 0.35   4 = 0.50 mm per side
//  Use the tightest ring the glass drops into and sits flat in.
// =====================================================================
gauge_clr = [0.15, 0.25, 0.35, 0.50];
module gauge_ring(c, n) {
  br = glass_d/2 + c; orr = br + wall + 0.4; lip = 1.0; depth = 3.0;
  difference() {
    union() {
      cylinder(r1 = orr - 0.6, r2 = orr, h = 0.6);
      translate([0, 0, 0.6]) cylinder(r = orr, h = lip + depth - 0.6);
    }
    translate([0, 0, lip]) cylinder(r = br, h = depth + 1);
    translate([0, 0, -eps]) cylinder(r = 19.1, h = lip + 2*eps);
  }
  for (k = [0:n-1]) rotate(90 + (k - (n-1)/2)*7) translate([br + (orr - br)/2, 0, lip + depth]) cylinder(d = 1.2, h = 0.6, $fn = 16);
}
module gauge() { for (i = [0:3]) translate([(i % 2)*52, floor(i/2)*52, 0]) gauge_ring(gauge_clr[i], i + 1); }

// =====================================================================
//  DESK STAND - separate print the puck sits in. Built for a 90-degree
//  "up/down angle" USB-C cable: plug into the puck with the cable pointing
//  backward, set the puck in, cable runs out the back through the tunnel.
//  World frame: desk at Z = 0, +Y away from you, puck facing -Y.
// =====================================================================
/* [Stand] */
lean      = 25;    // tilted option, NOT the current stand (current = the original 15 deg v1 stand file)
lift      = 5.8;   // raise the tilted stand so the plug clears the desk (~1.4 mm)
                   // tested: lean 25 -> lift 5.8;  lean 30 -> lift 8.5
base_back = 58;    // back edge of the flat base (Y); longer = harder to tip back
// the v1 stand (15 deg) is the cradle; it is tilted back about its front-bottom edge
lean0 = 15; screen_h0 = 38; base_w = 60; base_y0 = -12; base_y1 = 52;
base_t    = 4;
rest_t    = 5;     // back rest thickness behind the puck
rest_top  = 6;     // back rest stops this far above the screen centre (board Y)
rim_w     = 3;     // pocket wall thickness
chin_h    = 6;     // depth of the pocket around the bottom of the puck
chin_arc  = [225, 315]; // angles where the pocket is deep (BOOT cap spans ~320-334)
ring_h    = 1.8;   // pocket depth elsewhere - clears the plunger caps
seat_clr  = 0.3;
tunnel_w  = 15;    // slot for the plug head and cable
tunnel_h  = 14;
// right-angle plug envelope (typical up/down-angle USB-C head; check yours)
rh_w = 13; rh_len = 11; rh_t = 9; relief_d = 6.5; relief_len = 14; cable_drop = 6;

module pose_v1()   { translate([0, 0, screen_h0]) rotate([90 - lean0, 0, 0]) children(); }
module tilt()      { translate([0, base_y0, lift]) rotate([-(lean - lean0), 0, 0]) translate([0, -base_y0, 0]) children(); }
module puck_frame() { tilt() pose_v1() children(); }
module base2d(y0, y1) { offset(r = 6) offset(delta = -6) translate([-base_w/2, y0]) square([base_w, y1 - y0]); }

// the v1 stand body (before its cuts)
module stand_solid_v1() {
  R  = outer_r + seat_clr + rim_w;
  zb = -back_d;
  hull() {
    pose_v1() intersection() {
      translate([0, 0, zb - rest_t]) cylinder(r = R, h = rest_t + chin_h);
      translate([-60, -80, -60]) cube([120, 80 + rest_top, 120]);
    }
    linear_extrude(base_t) base2d(base_y0, base_y1);
  }
}

module stand() {
  R  = outer_r + seat_clr + rim_w;
  zb = -back_d;   // puck back face, board frame
  difference() {
    intersection() {
      hull() {
        tilt() stand_solid_v1();
        linear_extrude(base_t) base2d(base_y0, base_back);
      }
      translate([-100, -100, 0]) cube([200, 300, 200]);   // flat on the desk
    }
    // the puck itself, everything in front of its back face
    puck_frame() translate([0, 0, zb]) cylinder(r = outer_r + seat_clr, h = 40);
    // shallow pocket everywhere except the bottom arc
    puck_frame() difference() {
      translate([0, 0, zb + ring_h]) cylinder(r = R + 0.5, h = 40);
      linear_extrude(height = 200, center = true)
        polygon([[0, 0], for (a = [chin_arc[0]:5:chin_arc[1]]) 80*[cos(a), sin(a)]]);
    }
    // reliefs in the seat: screw heads, and vents behind the speaker and mic
    puck_frame() {
      for (h = holes) translate([h.x, h.y, zb - 0.6]) cylinder(d = 6.5, h = 1, $fn = 32);
      translate([spk.x - 7, -6, zb - 1.5]) cube([14, 60, 1.6]);
      translate([mic.x - 3, mic.y - 3, zb - 1.5]) cube([6, 60, 1.6]);
      // path for the plug head as the puck is lowered in
      translate([-tunnel_w/2, -80, zb - 1]) cube([tunnel_w, 80 - usb_mouth_r + 1, 30]);
    }
    // cable tunnel, open underneath, front to back
    translate([-tunnel_w/2, base_y0 - 20, -1]) cube([tunnel_w, base_back - base_y0 + 40, tunnel_h + 1]);
  }
}

module rh_plug() {   // approximate right-angle plug, for checks and previews
  translate([-rh_w/2, -(usb_mouth_r + rh_len), -(usb_d + rh_t/2)]) cube([rh_w, rh_len, rh_t]);
  translate([0, -(usb_mouth_r + cable_drop), -(usb_d + rh_t/2)])
    rotate([180, 0, 0]) cylinder(d = relief_d, h = relief_len, $fn = 24);
}

// =====================================================================
//  OUTPUT
// =====================================================================
module case_print() { translate([0, 0, back_d]) case(); }
if (part == "stand") stand();
if (part == "docked") {
  color([0.35, 0.37, 0.42]) stand();
  puck_frame() { board(); screws(); color([0.95, 0.55, 0.15]) case(); color("white") for (a = [pwr_ang, boot_ang]) plunger_placed(a); color([0.2, 0.2, 0.2]) rh_plug(); }
}
if (part == "check_stand_puck") intersection() { stand(); puck_frame() { case(); for (a = [pwr_ang, boot_ang]) plunger_placed(a); screws(); } }
if (part == "check_stand_plug") intersection() { stand(); puck_frame() rh_plug(); }
if (part == "plug_asm")  puck_frame() rh_plug();
if (part == "puck_asm")  puck_frame() { case(); screws(); }

if (part == "case")       case_print();
if (part == "button_pair") button_pair_print();
if (part == "gauge")      gauge();
if (part == "board")      board();
if (part == "assembly") {
  board(); screws();
  color([0.95, 0.55, 0.15]) case();
  color("white") for (a = [pwr_ang, boot_ang]) plunger_placed(a);
}
if (part == "exploded") {
  translate([0, 0, 16]) board();
  color("white") for (a = [pwr_ang, boot_ang]) translate([0, 0, 6]) plunger_placed(a);
  color([0.95, 0.55, 0.15]) case();
  translate([0, 0, -10]) screws();
}
if (part == "case_asm")    case();
if (part == "buttons_asm") for (a = [pwr_ang, boot_ang]) plunger_placed(a);
if (part == "screws_asm")  screws();
// interference checks: all should come out empty
if (part == "check_case")     intersection() { case(); board(); }
if (part == "check_buttons")  intersection() { for (a = [pwr_ang, boot_ang]) plunger_placed(a); board(); }
if (part == "check_btn_case") intersection() { for (a = [pwr_ang, boot_ang]) plunger_placed(a); case(); }
if (part == "check_screw_pcb") intersection() { screws(); translate([0, 0, zd(pcb_back_d) - 0.5]) cylinder(r = 30, h = 0.5 + 10); }

// =====================================================================
//  TEST SPACERS - go between each brass standoff and the case's pad to lift
//  the board. Whichever thickness stops the buttons sticking = how much
//  taller the pads should be. 3 per file (one per standoff).
// =====================================================================
spacer_t  = 0.6;
spacer_od = 4.0;   // smaller than the 5 mm pad so it stays clear of the BOOT plunger
spacer_id = 2.4;
module spacers_print() {
  for (i = [0:2]) translate([i*6, 0, 0]) difference() {
    cylinder(d = spacer_od, h = spacer_t, $fn = 64);
    translate([0, 0, -1]) cylinder(d = spacer_id, h = spacer_t + 2, $fn = 48);
  }
}
if (part == "spacers") spacers_print();
