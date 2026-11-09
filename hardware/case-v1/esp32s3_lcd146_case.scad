// =====================================================================
//  Case for the Waveshare ESP32-S3-Touch-LCD-1.46  (cover-glass version)
//
//  Three printed parts + 3 screws:
//    shell   - front bezel lip over the glass, side wall, USB-C / TF / button openings
//    cover   - back plate: clamps the board's three brass standoffs, speaker grille,
//              mic / LED / volume holes, window over the 2x10 1.27 mm header
//    buttons - two captive plungers for the side PWR and BOOT switches
//              (button_set = the same plungers at three switch gaps, to pick from)
//    3 x M2x8 pan-head self-tapping screws into 2.1 mm pilots
//
//  Assembly: shell face-down on the desk -> board in from the back, screen first,
//  USB-C into the bottom notch -> drop the two plungers into their notches (flange
//  inside) -> cover on (ribs either side of the USB-C) -> 3 screws, snug only.
//
//  Printing (PLA, 0.4 mm nozzle, 0.20 mm layers, no supports, all as exported):
//    gauge       first: 4 rings, ~10 min. Tightest ring the glass drops into flat
//                -> set glass_clr to that ring's value.
//    shell       lip face down on the plate
//    cover       back face down (pads and ribs up)
//    button_set  3 pairs of plungers at different switch gaps; keep the pair that
//                clicks cleanly and doesn't hold the button down
//
//  Re-export one part:  openscad -D 'part="shell"' -o shell.stl <this file>
//
//  FRAME (used for every position below)
//    Origin = centre of the board on the front face of the glass.
//    Looking at the screen with USB-C at the bottom: +X right, +Y up.
//    Depths "d" are measured from the glass front face going back (d = -Z).
//    Angles are counter-clockwise from +X (3 o'clock), seen from the front.
//
//  WHERE THE NUMBERS COME FROM
//    [DWG]  printed on Waveshare's dimension drawing (datasheet value, not measured)
//    [IMG]  scaled off the same drawing's photo at ~10.6 px/mm, about +/-0.5 mm
//    [FIT]  a printed fit test (PLA, 0.4 mm nozzle)
//    Nothing here has been measured on a real board yet.
// =====================================================================
/* [What to build] */
// shell / cover / buttons / gauge = print-ready parts; assembly / exploded = preview
part = "exploded"; // [shell, cover, buttons, button_set, gauge, assembly, exploded, board]
/* [Fit - tune these after the gauge] */
glass_clr   = 0.25;  // radial gap around the glass (gauge tests 0.15 / 0.25 / 0.35 / 0.50)
pad_gap     = 0.10;  // cover pads stop this far behind the standoffs (no load on the glass)
btn_gap     = 0.35;  // plunger face to switch tip at rest
btn_slide   = 0.20;  // plunger clearance in its notch, per side
pilot_d     = 2.10;  // [FIT] printed pilot-hole test, PLA
/* [Board - Waveshare drawing] */
glass_d     = 44.77; // [DWG] cover glass diameter
stack_body  = 11.00; // [DWG] glass front -> back of brass standoffs
stack_pins  = 12.30; // [DWG] glass front -> header pin tips
pcb_front_d = 6.41;  // [IMG] glass front -> PCB front face
pcb_back_d  = 7.53;  // [IMG] glass front -> PCB back face
pcb_d       = 41.33; // [DWG] PCB height (drawn ~39.3 wide; 41.33 used as the envelope)
holes = [[0, 18.85], [11.77, -13.85], [-11.77, -13.85]]; // [DWG 23.54 / 32.70 + IMG] M2 standoffs
/* [Board - side features, IMG] */
btn_tip_r   = 20.6;  // radius of the PWR / BOOT plunger tips
btn_d       = 9.0;   // depth of the switch actuators (on the PCB back; height not on drawing)
pwr_ang     = 37.5;  // PWR  - right side, about 1 o'clock
boot_ang    = -33;   // BOOT - right side, about 4 o'clock
tf_ang      = 3;     // TF card slot - right side, between the buttons, under the display
tf_d0       = 4.3;   // TF socket front (depth)
tf_d1       = 6.25;  // TF socket back (depth)
usb_mouth_r = 21.75; // [DWG 42.58] USB-C opening, below centre
usb_d       = 9.06;  // USB-C centre depth
usb_w       = 8.94;  // USB-C receptacle shell width (standard)
usb_h       = 2.75;  // receptacle height as drawn
/* [Board - back-side features, IMG] */
spk      = [12.04, 1.27];  spk_size = [11.8, 9.9];  // speaker
mic      = [-14.86, -10.52];                         // mic port
led_chg  = [6.86, -18.54];                           // charge LED
led_pwr  = [-7.20, -18.77];                          // power LED
trim     = [8.27, -10.05];                           // volume trimmer
hdr      = [-15.30, 1.00]; hdr_size = [4.7, 12.7];   // 2x10 1.27 mm header
bat      = [6.90, 15.40];                            // MX1.25 battery plug
/* [Case] */
wall        = 2.0;   // side wall
lip_t       = 1.0;   // bezel lip in front of the glass (5 layers)
lip_open_d  = 38.2;  // opening in the lip (active display is 36.96)
rear_d      = 11.3;  // depth of the shell's rear face (= front face of the cover); standoffs end at 11.0
cover_t     = 2.0;   // back cover thickness
pad_d       = 5.0;   // pads that press on the standoffs
// USB-C opening: sized for the plug's plastic overmold, not just the metal shell
usb_open_w  = 13.5;
usb_open_h  = 8.0;
usb_key     = true;  // ribs on the cover either side of the receptacle stop the board rotating
// side buttons
btn_notch_w = 5.0;   // slot in the wall (tangential)
btn_notch_d0= 7.2;   // front edge of the slot (depth)
btn_fl_w    = 7.4;   // inner flange that keeps the plunger in
btn_proud   = 0.6;   // plunger stands this far out of the wall
// TF window
tf_window   = true;  // false = no TF card opening in the side wall
tf_open_w   = 13.0;  // at the inside of the wall; flares outward for a fingernail
tf_flare    = 1.5;
// screws: M2x8 pan head, through the cover into lugs on the shell
boss_ang    = [90, 210, 305];
pilot_depth = 8.0;
screw_clr_d = 2.4;
head_d      = 4.4;   // counterbore for the pan head
head_h      = 1.3;
// back cover openings
hdr_window   = false; // true = open window over the 2x10 header for wiring
hdr_open     = [8.0, 16.0];
grille_hole  = 1.5;
grille_pitch = 2.4;
mic_hole     = 1.6;
led_hole     = 1.8;
trim_hole    = true;  // hole over the speaker-volume trimmer (small screwdriver)
trim_hole_d  = 3.2;
$fn = 96;
eps = 0.01;
// ---------- derived ----------
bore_r  = glass_d/2 + glass_clr;
outer_r = bore_r + wall;
boss_r  = bore_r + 0.85 + pilot_d/2;   // pilot centre: 0.85 mm of wall on the bore side
lobe_r  = pilot_d/2 + 1.0;            // 1.0 mm of wall outside the pilot
lobe_d0 = 2.6;                        // lugs start this deep (front stays a clean circle)
fl_in_r = btn_tip_r + btn_gap;        // plunger inner face
pl_d0   = btn_notch_d0 + btn_slide;   // plunger depth range
pl_d1   = rear_d - btn_slide;
function zd(d) = -d;                  // depth -> Z
// =====================================================================
//  2D outlines
// =====================================================================
module lobe2d(a, inset=0) {
  hull() {
    rotate(a) translate([boss_r - inset, 0]) circle(r = lobe_r);
    for (s = [-1, 1]) rotate(a + s*13) translate([outer_r - 0.5 - inset, 0]) circle(r = 0.5);
  }
}
module outline2d() {
  union() { circle(r = outer_r); for (a = boss_ang) lobe2d(a); }
}
// =====================================================================
//  SHELL
// =====================================================================
module shell() {
  ch = 0.8;  // front outer chamfer
  difference() {
    union() {
      // round body, chamfered front edge
      translate([0, 0, zd(rear_d)]) cylinder(r = outer_r, h = rear_d + lip_t - ch);
      translate([0, 0, lip_t - ch]) cylinder(r1 = outer_r, r2 = outer_r - ch, h = ch);
      // screw lugs: start lobe_d0 deep with a 45 deg underside so they print without support
      for (a = boss_ang) {
        translate([0, 0, zd(rear_d)]) linear_extrude(rear_d - lobe_d0) lobe2d(a);
        hull() {
          translate([0, 0, zd(lobe_d0) - eps]) linear_extrude(eps) lobe2d(a);
          translate([0, 0, zd(lobe_d0 - 2.0)]) linear_extrude(eps) lobe2d(a, inset = 2.0);
        }
      }
    }
    // glass bore
    translate([0, 0, zd(rear_d) - 1]) cylinder(r = bore_r, h = rear_d + 1);
    // lip opening, 45 deg chamfer toward the front so swipes reach the edge
    translate([0, 0, -eps]) cylinder(r1 = lip_open_d/2, r2 = lip_open_d/2 + lip_t, h = lip_t + 2*eps);
    // pilot holes for the cover screws
    for (a = boss_ang) rotate(a) translate([boss_r, 0, zd(rear_d) - 1]) {
      cylinder(d = pilot_d, h = pilot_depth + 1);
      cylinder(d1 = pilot_d + 1.2, d2 = pilot_d, h = 1.6);   // lead-in
    }
    usb_cut();
    for (a = [pwr_ang, boot_ang]) btn_notch(a);
    if (tf_window) tf_cut();
  }
}
// USB-C: U-shaped notch open to the back, rounded front corners
module usb_cut() {
  d0 = usb_d - usb_open_h/2;
  r  = 1.5;
  translate([0, -(bore_r - 1), 0]) rotate([90, 0, 0])
    linear_extrude(10)
      hull() {
        for (s = [-1, 1]) translate([s*(usb_open_w/2 - r), zd(d0) - r]) circle(r = r, $fn = 32);
        translate([-usb_open_w/2, zd(rear_d) - 2]) square([usb_open_w, 1]);
      }
}
module btn_notch(a) {
  rotate(a) translate([bore_r - 1, -btn_notch_w/2, zd(rear_d) - 1])
    cube([wall + 3, btn_notch_w, rear_d - btn_notch_d0 + 1]);
}
// TF window: slot through the wall, flared on the outside
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
//  BACK COVER
// =====================================================================
module cover() {
  ch = 0.6;  // back edge chamfer
  z0 = zd(rear_d + cover_t);
  difference() {
    union() {
      translate([0, 0, z0]) cylinder(r1 = outer_r - ch, r2 = outer_r, h = ch);
      translate([0, 0, z0 + ch]) cylinder(r = outer_r, h = cover_t - ch);
      for (a = boss_ang) hull() {
        translate([0, 0, z0]) linear_extrude(eps) offset(delta = -ch) lobe2d(a);
        translate([0, 0, z0 + ch]) linear_extrude(cover_t - ch) lobe2d(a);
      }
      // pads on the standoffs
      for (h = holes) translate([h.x, h.y, zd(rear_d) - eps])
        cylinder(d = pad_d, h = rear_d - (stack_body + pad_gap) + eps);
      // anti-rotation ribs either side of the USB-C receptacle
      if (usb_key) for (s = [-1, 1])
        translate([s*(usb_w/2 + 0.35 + 0.4) - 0.4, -21.2, zd(rear_d) - eps])
          cube([0.8, 5.6, rear_d - 9.6 + eps]);
    }
    // screw clearance + counterbore from the back
    for (a = boss_ang) rotate(a) translate([boss_r, 0, z0 - 1]) {
      cylinder(d = screw_clr_d, h = cover_t + 2, $fn = 32);
      cylinder(d = head_d, h = head_h + 1, $fn = 48);
    }
    // USB-C: pocket so the plug overmold can reach the receptacle
    translate([-usb_open_w/2, -outer_r - 5, zd(usb_d + usb_open_h/2)])
      cube([usb_open_w, outer_r + 5 - usb_mouth_r, usb_open_h/2 + 2]);
    // header window (or, with the window off, a shallow pocket for the pin tips)
    if (hdr_window) translate([hdr.x, hdr.y, z0 - 1])
      linear_extrude(cover_t + 2) offset(r = 1.5) offset(delta = -1.5)
        square(hdr_open, center = true);
    else translate([hdr.x, hdr.y, zd(stack_pins + 0.3)])
      linear_extrude(stack_pins + 0.3 - rear_d + 1)
        square([hdr_size.x + 1.5, hdr_size.y + 1.5], center = true);
    // speaker grille, hex pattern inside an ellipse over the speaker
    for (i = [-4:4], j = [-4:4]) {
      p = [i*grille_pitch + (j % 2 == 0 ? 0 : grille_pitch/2), j*grille_pitch*0.866];
      if (pow(p.x/((spk_size.x - 1.4)/2), 2) + pow(p.y/((spk_size.y - 1.4)/2), 2) <= 1)
        translate([spk.x + p.x, spk.y + p.y, z0 - 1]) cylinder(d = grille_hole, h = cover_t + 2, $fn = 16);
    }
    for (p = [[mic, mic_hole], [led_chg, led_hole], [led_pwr, led_hole]])
      translate([p[0].x, p[0].y, z0 - 1]) cylinder(d = p[1], h = cover_t + 2, $fn = 24);
    if (trim_hole) translate([trim.x, trim.y, z0 - 1]) cylinder(d = trim_hole_d, h = cover_t + 2, $fn = 32);
  }
}
// =====================================================================
//  BUTTON PLUNGERS (one each for PWR and BOOT)
//  Drawn with the push direction along +X; the flange inside the wall keeps it captive.
// =====================================================================
module plunger2d(gap = btn_gap) {
  cap_w = btn_notch_w - 2*btn_slide;
  in_r  = btn_tip_r + gap;
  union() {
    intersection() {
      translate([in_r, -btn_fl_w/2]) square([bore_r - in_r + 1, btn_fl_w]);
      circle(r = bore_r - 0.05, $fn = 192);
    }
    translate([bore_r - 0.8, -cap_w/2])
      offset(r = 0.6, $fn = 24) offset(delta = -0.6)
        square([outer_r + btn_proud - (bore_r - 0.8), cap_w]);
  }
}
module plunger_placed(a) {
  rotate(a) translate([0, 0, zd(pl_d1)]) linear_extrude(pl_d1 - pl_d0) plunger2d();
}
// =====================================================================
//  SIMPLIFIED BOARD (for previews and the interference check only)
// =====================================================================
module board() {
  color([0.08, 0.08, 0.08]) translate([0, 0, -2.0]) cylinder(d = glass_d, h = 2.0);
  color("silver") translate([0, 0, zd(pcb_front_d)]) cylinder(d = 40.2, h = pcb_front_d - 2.0);
  color([0.1, 0.3, 0.6]) translate([0, 0, zd(pcb_back_d)]) cylinder(d = pcb_d, h = pcb_back_d - pcb_front_d);
  color("gold") for (h = holes) translate([h.x, h.y, zd(stack_body)])
    difference() { cylinder(d = 3.5, h = stack_body - pcb_back_d, $fn = 6); cylinder(d = 1.6, h = 10, center = true, $fn = 16); }
  // header body + pins
  color([0.15, 0.15, 0.15]) translate([hdr.x - hdr_size.x/2, hdr.y - hdr_size.y/2, zd(9.66)])
    cube([hdr_size.x, hdr_size.y, 9.66 - pcb_back_d]);
  color("gold") for (i = [0:9], j = [0:1])
    translate([hdr.x + (j - 0.5)*1.27, hdr.y + (i - 4.5)*1.27, zd(stack_pins)]) cylinder(d = 0.4, h = stack_pins - 9.66, $fn = 8);
  // USB-C receptacle
  color("silver") translate([-usb_w/2, -usb_mouth_r, zd(usb_d + usb_h/2)]) cube([usb_w, 7.35, usb_h]);
  // side switches: body + actuator out to btn_tip_r
  for (a = [pwr_ang, boot_ang]) rotate(a) {
    color("white") translate([btn_tip_r - 5.5, -1.6, zd(10.9)]) cube([4.0, 3.2, 10.9 - pcb_back_d]);
    color("gray")  translate([btn_tip_r - 1.6, -0.8, zd(btn_d) - 0.7]) cube([1.6, 1.6, 1.4]);
  }
  // TF socket (front side of the PCB)
  color([0.1, 0.1, 0.1]) rotate(tf_ang) translate([btn_tip_r - 12, -7, zd(tf_d1)]) cube([12 - 0.2, 14, tf_d1 - tf_d0]);
  // speaker, battery plug
  color("tan") translate([spk.x - spk_size.x/2, spk.y - spk_size.y/2, zd(9.5)]) cube([spk_size.x, spk_size.y, 9.5 - pcb_back_d]);
  color("white") translate([bat.x - 3.0, bat.y - 2.2, zd(11.0)]) cube([6.0, 4.4, 11.0 - pcb_back_d]);
}
// =====================================================================
//  FIT GAUGE: four short rings, printed lip down. Dots on top = ring number.
//    1 dot = 0.15   2 = 0.25 (the default)   3 = 0.35   4 = 0.50 mm per side
//  Use the tightest ring where the glass drops in and sits flat on the lip.
// =====================================================================
gauge_clr = [0.15, 0.25, 0.35, 0.50];
module gauge_ring(c, n) {
  br = glass_d/2 + c;
  orr = br + wall;
  depth = 3.0;
  difference() {
    union() {
      cylinder(r1 = orr - 0.8, r2 = orr, h = 0.8);
      translate([0, 0, 0.8]) cylinder(r = orr, h = lip_t + depth - 0.8);
    }
    translate([0, 0, lip_t]) cylinder(r = br, h = depth + 1);
    translate([0, 0, -eps]) cylinder(r1 = lip_open_d/2 + lip_t, r2 = lip_open_d/2, h = lip_t + 2*eps);
  }
  for (k = [0:n-1]) rotate(90 + (k - (n-1)/2)*7) translate([br + wall/2, 0, lip_t + depth]) cylinder(d = 1.2, h = 0.6, $fn = 16);
}
module gauge() {
  for (i = [0:3]) translate([(i % 2)*52, floor(i/2)*52, 0]) gauge_ring(gauge_clr[i], i + 1);
}
// =====================================================================
//  OUTPUT
// =====================================================================
module shell_print()   { translate([0, 0, lip_t]) rotate([0, 180, 0]) shell(); }
module cover_print()   { translate([0, 0, rear_d + cover_t]) cover(); }
module buttons_print() { for (i = [0, 1]) translate([0, i*12, 0]) translate([-fl_in_r, 0, 0]) linear_extrude(pl_d1 - pl_d0) plunger2d(); }
// Three pairs at different switch gaps, marked with 1 / 2 / 3 small holes on top.
//   1 hole = 0.15 (tighter)   2 holes = 0.35 (default)   3 holes = 0.55 (looser)
btn_set_gaps = [0.15, 0.35, 0.55];
module button_set_print() {
  for (k = [0:2], i = [0, 1]) {
    g = btn_set_gaps[k];
    translate([k*9, i*11, 0]) difference() {
      translate([-(btn_tip_r + g), 0, 0]) linear_extrude(pl_d1 - pl_d0) plunger2d(g);
      for (m = [0:k]) translate([0.9, (m - k/2)*1.6, pl_d1 - pl_d0 - 0.6]) cylinder(d = 0.9, h = 1, $fn = 12);
    }
  }
}
if (part == "shell")    shell_print();
if (part == "cover")    cover_print();
if (part == "buttons")  buttons_print();
if (part == "button_set") button_set_print();
if (part == "gauge")    gauge();
if (part == "board")    board();
if (part == "assembly") {
  board();
  color([0.95, 0.55, 0.15]) shell();
  color([0.35, 0.35, 0.4]) cover();
  color("white") for (a = [pwr_ang, boot_ang]) plunger_placed(a);
}
if (part == "exploded") {
  translate([0, 0, 18]) color([0.95, 0.55, 0.15]) shell();
  board();
  color("white") for (a = [pwr_ang, boot_ang]) translate([0, 0, -10]) plunger_placed(a);
  translate([0, 0, -22]) color([0.35, 0.35, 0.4]) cover();
}
// parts in their assembled positions (for checks)
if (part == "shell_asm")   shell();
if (part == "cover_asm")   cover();
if (part == "buttons_asm") for (a = [pwr_ang, boot_ang]) plunger_placed(a);
// cut through the PWR button's axis (preview only)
if (part == "section") rotate(-pwr_ang) difference() {
  union() {
    board();
    color([0.95, 0.55, 0.15]) shell();
    color([0.35, 0.35, 0.4]) cover();
    color("white") for (a = [pwr_ang, boot_ang]) plunger_placed(a);
  }
  rotate(pwr_ang) translate([-50, 0, -50]) cube([100, 50, 100]);
}
// interference checks (should all render empty)
if (part == "check_shell")   intersection() { shell(); board(); }
if (part == "check_cover")   intersection() { cover(); board(); }
if (part == "check_buttons") intersection() { for (a = [pwr_ang, boot_ang]) plunger_placed(a); board(); }
if (part == "check_btn_wall") intersection() { for (a = [pwr_ang, boot_ang]) plunger_placed(a); shell(); }
if (part == "check_btn_cover") intersection() { for (a = [pwr_ang, boot_ang]) plunger_placed(a); cover(); }
if (part == "check_shell_cover") intersection() { shell(); cover(); }
