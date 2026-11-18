# Hardware

## Bill of materials

| Qty | Part | Notes | Where to buy |
|---|---|---|---|
| 1 | Waveshare **ESP32-S3-Touch-LCD-1.46**, cover-glass version | 1.46" 412×412 round touch display, ESP32-S3 (8 MB PSRAM, 16 MB flash), microphone, speaker | [Amazon](https://www.amazon.com/dp/B0DS83H2V6?tag=grok-puck-20) |
| 3 | **M2×6** button-head hex-socket machine screws | slim case: through the back into the board's own brass standoffs; tested with the case. From an M2 assortment (MYWISH, 800 pieces, 304 stainless steel, M2×4 to M2×20) | [Amazon](https://www.amazon.com/dp/B0CTJY6G5K?tag=grok-puck-20) (the assortment) |
| 1 | **USB-A to USB-C cable, 90° up/down angle**, 10 ft | the cable leaves the plug toward its front or back face, not sideways. This one fits the stand's slot (a little stiff). For another cable: the slot is 15 mm wide, sized for a plug head of about 13 × 11 × 9 mm, so check the head before buying. Installing the firmware needs a cable that carries data: if this one only charges, any other USB cable that carries data works for installing | [Amazon](https://www.amazon.com/dp/B0H24WF65K?tag=grok-puck-20) |
| 1 | **5 V 2.1 A USB-A charger** | the device runs on USB power only; USB-A, for the cable above. Tested: a LUOATIP cube charger | [Amazon](https://www.amazon.com/dp/B07TK6MPNB?tag=grok-puck-20) (a 3-pack) |
| | PLA filament | case, stand, button plungers | any PLA |

As an Amazon Associate I earn from qualifying purchases.

The earlier, larger case (`case-v1/`) uses **3 × M2×8 pan-head self-tapping screws** instead, into
2.1 mm pilot holes.

### Second board: the AMOLED-1.8 *(being tested)*

The firmware also runs on the Waveshare **ESP32-S3-Touch-AMOLED-1.8**, which comes in its own case, so
nothing needs printing. It has its own firmware build and its own Install button on the installer page
(spec §4.8).

| Qty | Part | Notes | Where to buy |
|---|---|---|---|
| 1 | Waveshare **ESP32-S3-Touch-AMOLED-1.8** | 1.8" 368×448 AMOLED touch display (not round), ESP32-S3 (8 MB PSRAM, 16 MB flash), ES8311 codec with microphone and speaker, in a black case. V1 (SH8601 + FT3168) and V2 (CO5300 + CST820, from 30 May 2026) share one build; only V2 is tested so far. The version without a battery is enough: the device runs on USB power | *link coming soon* |
| 1 | Any USB cable that carries data, and a 5 V USB charger | USB-C at the board's end. The angled cable above is for the round device's stand | any |

Being tested: the face, touch, speaking and listening, and Wi-Fi setup on a V2 board in its case.
Whether it needs a stand on the desk isn't decided yet.

## Prints

All parts: PLA, 0.4 mm nozzle, 0.20 mm layers, no supports, oriented as exported.

**Ready-to-print files:** [print-files/](print-files/) *(coming soon)*. Until they are there, print the
STL files below.

### Slim case and stand (`case-slim/`, current design)

![Slim case](case-slim/lcd146_slim_preview.png)
![Slim case in its stand](case-slim/lcd146_slim_stand_preview.png)

| File | What | Print |
|---|---|---|
| `lcd146_slim_gauge.stl` | four rings at 0.15 / 0.25 / 0.35 / 0.50 mm clearance around the 44.77 mm glass (dots = ring number) | first, about 10 min; only needed if a case comes out tight or loose |
| `lcd146_slim_case.stl` | one piece: back plate and a wall flush with the glass, 48.5 mm across, 13.4 mm thick; header covered | back face down |
| `lcd146_slim_button_set.stl` | PWR and BOOT plungers at three switch gaps (0.15 / 0.35 / 0.55 mm, marked 1 / 2 / 3 holes) | keep the pair that clicks cleanly without holding the button down |
| `lcd146_slim_stand.stl` | desk stand, 15° lean, 60 × 64 × 41 mm, screen centre 38 mm above the desk; the plug drops into a slot and the cable runs out through a tunnel | base down, **40 % infill or more**, so tapping the top of the screen doesn't tip it back |

**Assembly:** case face up → drop each plunger in from the inside, cap out through its window → lower
the board in, screen up, USB-C into the bottom notch → hold the board, turn the case over → 3 screws,
snug only. **Docking:** plug the cable in pointing back, lower the case into the stand so the plug drops
into the slot, lay the cable in the tunnel.

### Earlier, larger case (`case-v1/`)

A shell with a lip over the glass plus a back cover with a speaker grille and mic, LED and volume-knob
holes, 49.3 × 51.2 × 14.3 mm. This one has been printed and fits.

| File | Print |
|---|---|
| `lcd146_case_shell.stl` | lip face down |
| `lcd146_case_cover.stl` | back face down (pads and ribs up) |
| `lcd146_case_button_set.stl` | plungers at three switch gaps, as above (0.1 mm shorter than the slim set; not interchangeable) |

## Editing the models

Both cases are parametric OpenSCAD files. Every board position is a parameter at the top; set `part`
and export:

```sh
openscad -D 'part="case"'  -o case.stl  case-slim/esp32s3_lcd146_slim.scad   # case, button_set, gauge, stand
openscad -D 'part="shell"' -o shell.stl case-v1/esp32s3_lcd146_case.scad     # shell, cover, buttons, button_set, gauge
```

## Known issues

- **Nothing is measured yet.** Board positions come from Waveshare's dimension drawing: printed values,
  plus values scaled off its photo, about ±0.5 mm.
- **The TF-card window sits a little off** on the printed case: it should turn toward the USB-C
  connector. The angle is the `tf_ang` parameter (now 3°, counter-clockwise from 3 o'clock seen from the
  front; USB-C is at -90°). It must stay clear of the BOOT plunger window at -33°.
- **The case and stand have been printed and tested** with the parts in the bill of materials: the
  cable fits the stand, and the case takes M2×6 screws.
- The USB-C opening (13.5 × 8 mm) can shrink to the chosen cable's plug housing plus 0.5 mm.
- The `.scad` files were recovered from text listings and checked token for token. Some spacing inside
  comments may differ from the original, but the code is unchanged.
