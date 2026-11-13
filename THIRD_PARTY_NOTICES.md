# Third-party notices

Code in this repository that was copied from other open-source projects, with their licences.
Packages that are only installed as dependencies (through pnpm or the ESP-IDF component manager) carry
their own licences and are not listed here.

What the project publishes contains third-party software too, with its own notices, which ship with
each release and on the installer page:

- the firmware (ESP-IDF and what it builds in, LVGL, Espressif's components, cJSON):
  [firmware/NOTICES.md](firmware/NOTICES.md), with the longer licence texts in
  [firmware/licenses/](firmware/licenses/) and the C library's from ESP-IDF;
- the installer page (ESP Web Tools and what it bundles): [installer/NOTICES.md](installer/NOTICES.md).

## shadcn/ui

The admin page's components in `bridge/admin/src/components/ui/` and the Tailwind additions in
`bridge/admin/src/styles/shadcn.css` come from shadcn/ui (registry style `base-nova`, CLI 4.23.0),
adapted: imports point at this project's files and icons are lucide-react.
https://github.com/shadcn-ui/ui

```
MIT License

Copyright (c) 2023 shadcn

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
