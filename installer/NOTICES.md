# Third-party notices: the installer page

The installer page's own files (`page/`) are MIT-licensed, like the rest of Grok Puck
([LICENSE](../LICENSE)). The page also serves ESP Web Tools' web build, copied from
`node_modules/esp-web-tools/dist/web` by `scripts/package.mjs`, which bundles the packages below. The
list is every package in this folder's `pnpm-lock.yaml`; each licence comes from the package's own
licence file. The firmware the page installs has its own list: [firmware/NOTICES.md](../firmware/NOTICES.md).

**Keep it up to date** when a package changes: `test/notices.test.mjs` fails when a package in
`pnpm-lock.yaml` isn't named here with its version.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| esp-web-tools | 10.4.0 | Apache-2.0 | ESPHome maintainers |
| esptool-js | 0.6.1 | Apache-2.0 | Espressif Systems |
| improv-wifi-serial-sdk | 2.8.0 | Apache-2.0 | Improv Wi-Fi maintainers |
| @material/web | 2.5.0 | Apache-2.0 | Google LLC |
| lit | 3.3.3 | BSD-3-Clause | Google LLC |
| lit-element | 4.2.2 | BSD-3-Clause | Google LLC |
| lit-html | 3.3.3 | BSD-3-Clause | Google LLC |
| @lit/reactive-element | 2.1.2 | BSD-3-Clause | Google LLC |
| @lit/context | 1.1.6 | BSD-3-Clause | Google LLC |
| @lit-labs/ssr-dom-shim | 1.6.0 | BSD-3-Clause | Google LLC (its package names the licence; it has no licence file) |
| pako | 2.2.0 | MIT AND Zlib | Vitaly Puzrin and Andrei Tuputcyn; zlib: Jean-loup Gailly and Mark Adler |
| atob-lite | 2.0.0 | MIT | Hugh Kennedy (its author; the licence file names no holder) |
| tslib | 2.9.1 | 0BSD | Microsoft Corporation |
| @types/trusted-types | 2.0.7 | MIT | Microsoft Corporation (type definitions only: nothing of it is in the page) |

## Licence texts

### Apache License 2.0

Applies to esp-web-tools, esptool-js, improv-wifi-serial-sdk and @material/web. The full text is in
[firmware/licenses/Apache-2.0.txt](../firmware/licenses/Apache-2.0.txt) (the same text).

### lit, lit-element, lit-html, @lit/reactive-element, @lit/context, @lit-labs/ssr-dom-shim (BSD-3-Clause)

```
BSD 3-Clause License

Copyright (c) 2017 Google LLC. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

@lit/context's licence file says Copyright (c) 2021 Google LLC, with the same text.

### pako (MIT AND Zlib)

```
(The MIT License)

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

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

pako's zlib port, as its source files state it:

```
(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
  claim that you wrote the original software. If you use this software
  in a product, an acknowledgment in the product documentation would be
  appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
  misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```

### atob-lite (MIT)

```
This software is released under the MIT license:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### tslib (0BSD)

```
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```
