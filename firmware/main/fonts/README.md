# Fonts made for the firmware

LVGL's built-in fonts come in Montserrat Medium only. The bot's name under the face (spec §4.3.2)
reads better heavier, so it has a font of its own.

| File | What | Made from |
|---|---|---|
| `font_name_bold_24.c` | Montserrat Bold, 24 px, 4 bits per pixel, printable ASCII (U+0020 to U+007E): the bot's name | `fonts/ttf/Montserrat-Bold.ttf` of the Montserrat project's release [v7.222](https://github.com/JulietaUla/Montserrat/releases/tag/v7.222), SHA-256 `4e6d93bc38122c371acb8dc0dbefbf2649c235191e1be136bb5720546d719808` |

Montserrat is under the SIL Open Font License 1.1
([../../licenses/Montserrat-OFL.txt](../../licenses/Montserrat-OFL.txt)); [../../NOTICES.md](../../NOTICES.md)
lists it with the rest of what the firmware contains.

## Making it again

With the font file in `font-src/` (the converter is pinned; its dependencies come bundled in its
package):

```sh
pnpm dlx lv_font_conv@1.5.3 --font font-src/Montserrat-Bold.ttf -r 0x20-0x7E --size 24 --bpp 4 \
  --no-compress --no-prefilter --force-fast-kern-format --format lvgl \
  --lv-font-name font_name_bold_24 -o font-out/font_name_bold_24.c
```

These are the options LVGL used for its built-in Montserrat fonts. Then, for ESP-IDF and LVGL 9, two
edits by hand: the include becomes plain `#include "lvgl.h"`, and the font gets
`.static_bitmap = 1` (its bitmaps are constant, as in LVGL's own fonts).

The admin page's previews measure the name with this font's letter widths
(`bridge/admin/src/lib/botname.ts`): if the font changes, take them from its `glyph_dsc` again.
