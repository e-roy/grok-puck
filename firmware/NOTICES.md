# Third-party notices: the firmware

Grok Puck's own firmware code is MIT-licensed ([LICENSE](../LICENSE)). The firmware that the releases
and the installer page publish (the bootloader and the app) also contains the third-party software
below, each under its own licence. Every release and the installer page carry this file, the licence
texts in [licenses/](licenses/), and the C library's licence file from the ESP-IDF that built the
firmware (see picolibc below).

**How this list was made**, from a build with ESP-IDF 6.1.0 and the components pinned in
[dependencies.lock](dependencies.lock):

- the link maps (`build/desk_display.map` and `build/bootloader/bootloader.map`) name every library
  and object file that went into the firmware;
- `esp-idf-sbom create --rem-unused build/project_description.json` (ESP-IDF's SBOM tool, installed
  with ESP-IDF 6.1) lists the same packages, with the versions ESP-IDF's manifests give them;
- each licence comes from the library's own licence file or from the headers of the files that are
  linked in.

Code in the chip's ROM, which the firmware calls, is part of the chip and not in these files.

**Keep it up to date** when ESP-IDF, a component in `dependencies.lock`, or `sdkconfig.defaults`
changes what is built in (a new LVGL feature or font, for example). The installer's tests
(`installer/test/notices.test.mjs`) fail when this file doesn't name the ESP-IDF version or the
version of each component in `dependencies.lock`.

## What the firmware contains

| Part | Version | Licence | Copyright |
|---|---|---|---|
| ESP-IDF: the bootloader, drivers, Wi-Fi and network glue, NVS, HTTP server, TLS, timers, logging and the rest of the system | 6.1.0 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| Espressif's Wi-Fi, PHY and coexistence libraries (binary, part of ESP-IDF) | 6.1.0 | Apache-2.0 | Espressif Systems |
| ↳ FreeBSD net80211, inside the Wi-Fi library | | BSD-2-Clause | Sam Leffler, Errno Consulting; Atsushi Onoe |
| FreeRTOS kernel (ESP-IDF's version) | 10.5.1 | MIT | Amazon.com, Inc. or its affiliates |
| Xtensa HAL and FreeRTOS's Xtensa port | | MIT | Tensilica Inc.; Cadence Design Systems, Inc.; Amazon.com, Inc. or its affiliates |
| lwIP (TCP/IP), with ESP-IDF's port | 2.2.0 | BSD-3-Clause | Swedish Institute of Computer Science, and the other holders below |
| wpa_supplicant (Wi-Fi security) | 2.10 | BSD-3-Clause | Jouni Malinen and contributors, and the other holders below |
| Mbed TLS and TF-PSA-Crypto | 4.1.0 and 1.1.0 | Apache-2.0 (offered as Apache-2.0 OR GPL-2.0-or-later; used under Apache-2.0) | The Mbed TLS Contributors; ARM Limited |
| Fast PBKDF2, in ESP-IDF's wpa_supplicant glue | | CC0-1.0 | Joseph Birr-Pixton |
| TLSF memory allocator | | BSD-3-Clause | Matthew Conte |
| UBSAN runtime | | BSD-2-Clause | Linaro Limited; Jiří Zárevúcky |
| HTTP Parser | 2.7.0 | MIT | Joyent, Inc. and other Node contributors; based on NGINX by Igor Sysoev |
| Root certificates (ESP-IDF's certificate bundle, from Mozilla's list as extracted by curl, dated 11 February 2026) | | MPL-2.0 | Mozilla |
| picolibc (the C library, from the toolchain) | 1.8.10 | BSD-3-Clause and others, per file | Keith Packard, The Newlib Project and others |
| GCC runtime libraries: libgcc and libstdc++ (toolchain esp-15.2.0_20251204) | 15.2.0 | GPL-3.0-or-later WITH GCC-exception-3.1 | Free Software Foundation, Inc. |
| LVGL (`lvgl/lvgl`) | 9.6.0~1 | MIT | LVGL Kft |
| ↳ QR Code generator, in LVGL | | MIT | Project Nayuki |
| ↳ printf, in LVGL | | MIT | Marco Paland (PALANDesign Hannover) |
| ↳ Montserrat font (LVGL's Montserrat 14 and 24) | | OFL-1.1 | The Montserrat Project Authors |
| ↳ Font Awesome 5 Free symbols, in the same LVGL fonts | | OFL-1.1 | Fonticons, Inc. |
| cJSON (`espressif/cjson`) | 1.7.19~2 | MIT | Dave Gamble and cJSON contributors |
| `espressif/esp_websocket_client` | 1.8.0 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/esp_lvgl_port` | 2.9.0 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/esp_lcd_spd2010` | 2.0.0~1 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/esp_lcd_touch_spd2010` | 2.1.0 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/esp_lcd_touch` | 1.2.1 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/esp_io_expander_tca9554` | 2.0.3 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/esp_io_expander` | 1.2.1 | Apache-2.0 | Espressif Systems (Shanghai) CO LTD |
| `espressif/cmake_utilities` | 0.5.3 | Apache-2.0 | used by the build only: none of it is in the firmware |

## Licence texts

### Apache License 2.0

Applies to ESP-IDF and Espressif's binary libraries (Copyright 2015-2026 Espressif Systems (Shanghai)
CO LTD), to Mbed TLS and TF-PSA-Crypto (Copyright The Mbed TLS Contributors; ESP-IDF's AES-XTS port:
Copyright (C) 2006-2015, ARM Limited, All Rights Reserved), and to the Espressif components in the table.
The full text is in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).

### FreeRTOS kernel (MIT)

```
Copyright (C) 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Xtensa HAL and Xtensa port (MIT)

The Xtensa HAL library (`libxt_hal`) and headers, and the Xtensa interrupt, context and vector code
and FreeRTOS's Xtensa port, as ESP-IDF's COPYRIGHT file and the source headers give them:

```
Copyright (C) 2003, 2006, 2010 Tensilica Inc.
Copyright (c) 2015-2019 Cadence Design Systems, Inc.
Copyright (c) 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### lwIP (BSD-3-Clause)

The files linked in also name these holders, under the same licence: Copyright (c) 2001-2004 Leon
Woestenberg and Axon Digital Design B.V., The Netherlands (ARP, Ethernet, DHCP); Copyright (c) 2002
CITEL Technologies Ltd. (IGMP); Copyright (c) 2002-2003, Adam Dunkels (DNS); Copyright (c) 2010 Inico
Technologies Ltd. (IPv6). ESP-IDF's lwIP port (`sys_arch.c`, `wlanif.c`, `ethernetif.c`) is Copyright
(c) 2001-2004 Swedish Institute of Computer Science, under the same licence.

```
Copyright (c) 2001, 2002 Swedish Institute of Computer Science.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY
OF SUCH DAMAGE.
```

ESP-IDF's TCP initial sequence number hook (`tcp_isn_default.c`, by David van Moolenbroek):

```
Copyright (c) 2016 The MINIX 3 Project.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY
OF SUCH DAMAGE.
```

### wpa_supplicant (BSD-3-Clause)

The files linked in also name Copyright (c) 2019 and Copyright (c) 2020, The Linux Foundation (SAE),
and Copyright (c) 2013 Cozybit, Inc. (AES-SIV), under the same licence.

```
wpa_supplicant and hostapd
--------------------------

Copyright (c) 2002-2019, Jouni Malinen <j@w1.fi> and contributors
All Rights Reserved.

These programs are licensed under the BSD license (the one with
advertisement clause removed).

License
-------

This software may be distributed, used, and modified under the terms of
BSD license:

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

3. Neither the name(s) of the above-listed copyright holder(s) nor the
   names of its contributors may be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### FreeBSD net80211 (BSD-2-Clause)

ESP-IDF's COPYRIGHT file names FreeBSD net80211, Copyright (C) 2004-2008 Sam Leffler, Errno
Consulting, under the BSD licence, as part of Espressif's Wi-Fi library. FreeBSD's net80211 licence:

```
Copyright (c) 2001 Atsushi Onoe
Copyright (c) 2002-2009 Sam Leffler, Errno Consulting
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### TLSF memory allocator (BSD-3-Clause)

```
Copyright (c) 2006-2016, Matthew Conte
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the copyright holder nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL MATTHEW CONTE BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### UBSAN runtime (BSD-2-Clause)

```
Copyright (c) 2016, Linaro Limited
Modified for HelenOS use by Jiří Zárevúcky.
Adaptations for ESP-IDF Copyright (c) 2020 Espressif Systems (Shanghai) Co. Ltd.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### HTTP Parser (MIT)

```
Based on src/http/ngx_http_parse.c from NGINX copyright Igor Sysoev

Additional changes are licensed under the same terms as NGINX and
copyright Joyent, Inc. and other Node contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

### Fast PBKDF2 (CC0-1.0)

Copyright (C) 2015 Joseph Birr-Pixton, dedicated to the public domain under the CC0 1.0 Universal
Public Domain Dedication (https://creativecommons.org/publicdomain/zero/1.0/).

### Root certificates (MPL-2.0)

The firmware holds ESP-IDF's bundle of root certificates
(`components/mbedtls/esp_crt_bundle/cacrt_all.pem` in ESP-IDF 6.1.0): certificate data from Mozilla's
root store (`certdata.txt`, last updated 11 February 2026), converted by curl's `mk-ca-bundle.pl`. It
is licensed under the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). Its source form is
available from Mozilla
(https://raw.githubusercontent.com/mozilla-firefox/firefox/refs/heads/release/security/nss/lib/ckfw/builtins/certdata.txt),
from curl (https://curl.se/docs/caextract.html) and in ESP-IDF (https://github.com/espressif/esp-idf).

### picolibc (BSD-3-Clause and others)

The C library comes from the toolchain's picolibc 1.8.10. Its copyright holders and licences, per
file, are in ESP-IDF's `components/esp_libc/COPYING.picolibc`
(https://github.com/espressif/esp-idf/blob/v6.1/components/esp_libc/COPYING.picolibc). That file
isn't kept in this repository: the build copies it from the ESP-IDF that built the firmware, and the
notices file of every release and of the installer page include it in full.

### GCC runtime libraries (GPL-3.0-or-later WITH GCC-exception-3.1)

libgcc and libstdc++ come with the toolchain (GCC 15.2.0, Espressif's esp-15.2.0_20251204), Copyright
(C) Free Software Foundation, Inc. They are under the GNU General Public License version 3 with the
GCC Runtime Library Exception 3.1 (https://www.gnu.org/licenses/gcc-exception-3.1.html), which lets a
program compiled with GCC carry them under the program's own licence.

### LVGL (MIT)

```
MIT licence
Copyright (c) 2025 LVGL Kft

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### QR Code generator, in LVGL (MIT)

```
Copyright © 2025 Project Nayuki. (MIT License)
https://www.nayuki.io/page/qr-code-generator-library

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

The Software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the Software or the use or other dealings in the Software.
```

### printf, in LVGL (MIT)

```
(c) Marco Paland (info@paland.com)
    2014-2019, PALANDesign Hannover, Germany

The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Montserrat and Font Awesome 5 Free (OFL-1.1)

LVGL's built-in Montserrat fonts are made from Montserrat Medium, with symbols from Font Awesome 5
Free. Both are under the SIL Open Font License 1.1, as LVGL ships them:
[licenses/Montserrat-OFL.txt](licenses/Montserrat-OFL.txt) (Copyright 2011 The Montserrat Project
Authors) and [licenses/FontAwesome5-LICENSE.txt](licenses/FontAwesome5-LICENSE.txt) (Copyright (c)
2022 Fonticons, Inc., Reserved Font Name "Font Awesome").

### cJSON (MIT)

```
Copyright (c) 2009-2017 Dave Gamble and cJSON contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
