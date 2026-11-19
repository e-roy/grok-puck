// The packaging script on fixture builds, one per board: what it writes for good builds, and every way
// it refuses them (above all, anything that would write over NVS, where the device keeps its settings,
// and a build packaged as the wrong board).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLASH_ARGS, PARTITIONS, app, image, makeBuild, partitionTable, tempDir } from './fixture.mjs';
import { createHash } from 'node:crypto';
import { AMAZON_TAG, BOARDS, PackageError, amazonLink, inlineStyleHashes, parseBuild, readFirmware, readFirmwares, writePackage } from '../scripts/package.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/package.mjs', import.meta.url));
const FIRMWARE = fileURLToPath(new URL('../../firmware/', import.meta.url));
const HARDWARE = fileURLToPath(new URL('../../hardware/', import.meta.url));
const DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases.';
/** The Amazon links in some HTML: [{ tag, url }]. */
const amazonAnchors = (html) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/g)].filter((m) => /\b(?:amazon|amzn)\./i.test(m[1])).map((m) => ({ tag: m[0], url: m[1] }));
/** The Amazon links in some Markdown. */
const amazonLinks = (md) => [...md.matchAll(/\]\(([^)\s]*\b(?:amazon|amzn)\.[^)\s]*)\)/gi)].map((m) => m[1]);
const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const LCD = 'waveshare-lcd-1.46';
const AMOLED = 'waveshare-amoled-1.8';
// Each board's card on the page: its id, its board, and the ASIN its "buy it" link (and its bill of
// materials) points at.
const CARDS = [
  { id: 'board-lcd-146', board: LCD, asin: 'B0DS83H2V6' },
  { id: 'board-amoled-18', board: AMOLED, asin: 'B0DSVK5576' },
];
// Each device's images: for the READMEs, and for its card on the installer page.
const IMAGES = [
  { name: 'photo.jpg', longSide: 1600, bytes: 250_000 },
  { name: 'photo-small.jpg', longSide: 600, bytes: 40_000 },
];

/** A JPEG's segments up to the image data ({ marker, id, at, length }; id: an APPn's identifier), its size, and how many bytes follow its end. */
function jpegSegments(data) {
  assert.ok(data[0] === 0xff && data[1] === 0xd8, 'a JPEG starts with SOI');
  const segments = [];
  let size;
  let at = 2;
  for (;;) {
    assert.equal(data[at], 0xff, `a marker at byte ${at}`);
    while (data[at + 1] === 0xff) at++; // fill bytes
    const marker = data[at + 1];
    if (marker === 0xd9) return { segments, size, trailing: data.length - (at + 2) };
    const length = data.readUInt16BE(at + 2);
    const payload = data.subarray(at + 4, at + 2 + length);
    const nul = payload.indexOf(0);
    const id = marker >= 0xe0 && marker <= 0xef ? payload.subarray(0, nul < 0 ? Math.min(payload.length, 32) : nul).toString('latin1') : '';
    segments.push({ marker, id, at, length });
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) size = { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
    at += 2 + length;
    if (marker === 0xda) {
      // The entropy-coded data, to the next marker: not a stuffed 0xFF00, not a restart marker.
      while (at < data.length - 1 && !(data[at] === 0xff && data[at + 1] !== 0x00 && !(data[at + 1] >= 0xd0 && data[at + 1] <= 0xd7))) at++;
    }
    assert.ok(at < data.length, 'the JPEG ends with EOI');
  }
}

const made = [];
const build = (options) => {
  const dir = makeBuild(options);
  made.push(dir);
  return dir;
};
const out = () => {
  const dir = tempDir();
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A build for every board: [{ board, dir }]; `options[board]` changes one board's build. */
const builds = (options = {}) => BOARDS.map((b) => ({ board: b.id, dir: build({ board: b.id, ...options[b.id] }) }));

const refuses = (options, message, read = {}) =>
  assert.throws(() => readFirmware(build(options), { board: options.board ?? LCD, ...read }), (err) => err instanceof PackageError && message.test(err.message));
const refusesSet = (set, message, read = {}) => assert.throws(() => readFirmwares(set, read), (err) => err instanceof PackageError && message.test(err.message));

test('the boards are the folders in firmware/boards/, each naming itself in its board_config.h', () => {
  const folders = fs.readdirSync(path.join(FIRMWARE, 'boards')).filter((d) => fs.existsSync(path.join(FIRMWARE, 'boards', d, 'board_config.h')));
  assert.deepEqual(folders.sort(), BOARDS.map((b) => b.id).sort());
  for (const id of folders) {
    const config = fs.readFileSync(path.join(FIRMWARE, 'boards', id, 'board_config.h'), 'utf8');
    assert.match(config, new RegExp(`#define BOARD_NAME "${id.replaceAll('.', '\\.')}"`), `${id}'s board_config.h names it`);
  }
});

test('hardware/ has a folder per board, named like it, each with its README and its two photos', () => {
  const folders = fs.readdirSync(HARDWARE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(folders.sort(), BOARDS.map((b) => b.id).sort(), 'one folder per board in firmware/boards/, and no other');
  for (const b of BOARDS) {
    assert.ok(fs.existsSync(path.join(HARDWARE, b.id, 'README.md')), `${b.id}: README.md`);
    assert.deepEqual(fs.readdirSync(path.join(HARDWARE, b.id, 'images')).sort(), IMAGES.map((i) => i.name).sort(), `${b.id}: images/`);
  }
});

test("each device's bill of materials: Amazon links with the page's tracking ID and nothing after the ASIN, the disclosure right below each table that has them; the index has none", () => {
  for (const { board, asin } of CARDS) {
    const readme = readText(path.join(HARDWARE, board, 'README.md'));
    const links = amazonLinks(readme);
    assert.ok(links.length > 0, `${board}: its bill of materials has Amazon links`);
    for (const url of links) assert.match(url, new RegExp(`^https://www\\.amazon\\.com/dp/[A-Z0-9]{10}\\?tag=${AMAZON_TAG}$`), url);
    const bom = /^## Bill of materials\n\n((?:\|.*\n)+)\n(.*)\n/m.exec(readme);
    assert.ok(bom, `${board}: the bill of materials is a table`);
    assert.ok(bom[1].includes(`(${amazonLink(asin)})`), `${board}: the table links to the board, as its card on the page does`);
    // Every table with an Amazon link has the disclosure on the line right after it.
    const tables = [...readme.matchAll(/^((?:\|.*\n)+)\n(.*)\n/gm)].filter((m) => /\b(?:amazon|amzn)\./i.test(m[1]));
    assert.equal(tables.length, 1, `${board}: one table with Amazon links`);
    for (const [, , below] of tables) assert.equal(below, DISCLOSURE, `${board}: the disclosure right below the table`);
    assert.equal(readme.split(DISCLOSURE).length - 1, 1, `${board}: the disclosure once`);
    assert.doesNotMatch(readme, /\$\s?\d/, "no prices (Amazon's rules)");
  }
  const index = readText(path.join(HARDWARE, 'README.md'));
  assert.equal(amazonLinks(index).length, 0, 'hardware/README.md, the index, has no Amazon links');
});

test("the devices' photos carry no metadata: no Exif, XMP or other APPn segment but JFIF and a colour profile, no comment, nothing after the image", () => {
  for (const b of BOARDS) {
    for (const { name, longSide, bytes } of IMAGES) {
      const file = `${b.id}/images/${name}`;
      const data = fs.readFileSync(path.join(HARDWARE, file));
      const { segments, size, trailing } = jpegSegments(data);
      assert.ok(size, `${file}: has a frame header`);
      for (const s of segments) {
        if (s.marker >= 0xe0 && s.marker <= 0xef) {
          const allowed = (s.marker === 0xe0 && s.id === 'JFIF') || (s.marker === 0xe2 && s.id === 'ICC_PROFILE');
          assert.ok(allowed, `${file}: APP${s.marker - 0xe0} "${s.id}" at byte ${s.at} (metadata: strip it)`);
        }
        assert.notEqual(s.marker, 0xfe, `${file}: a comment at byte ${s.at}`);
      }
      assert.equal(trailing, 0, `${file}: nothing after the end of the image (phones append a second image there)`);
      for (const sign of ['Exif', 'http://ns.adobe.com/xap/', '<x:xmpmeta', 'Photoshop 3.0']) assert.ok(!data.includes(sign), `${file}: holds "${sign}"`);
      assert.ok(Math.max(size.width, size.height) <= longSide && data.length <= bytes, `${file}: ${size.width}×${size.height}, ${data.length} bytes: at most ${longSide} px and ${bytes} bytes`);
    }
  }
});

test('an Amazon link is the product page and the tracking ID, for an ASIN only', () => {
  assert.equal(amazonLink('B0DS83H2V6'), `https://www.amazon.com/dp/B0DS83H2V6?tag=${AMAZON_TAG}`);
  for (const bad of ['b0ds83h2v6', 'B0DS83H2V', 'B0DS83H2V6?x=1', '']) assert.throws(() => amazonLink(bad), /is not an Amazon ASIN/);
});

describe('good builds, one per board', () => {
  const set = builds();
  const target = path.join(out(), 'dist');
  const pack = readFirmwares(set, { version: '0.6.0' });
  writePackage({ pack, out: target, commit: 'a'.repeat(40), pageUrl: 'https://owner.github.io/grok-puck/' });
  const site = path.join(target, 'site');
  const release = path.join(target, 'release');
  const names = (board) => ['bootloader', 'partition-table', 'ota-data', 'app'].map((r) => `grok-puck-0.6.0-${board}-${r}.bin`);

  test('reads each board: the version, the chip and the four parts in flash order', () => {
    assert.equal(pack.version, '0.6.0');
    assert.deepEqual(pack.firmwares.map((f) => f.board), [LCD, AMOLED]);
    for (const f of pack.firmwares) {
      assert.equal(f.chipFamily, 'ESP32-S3');
      assert.deepEqual(
        f.parts.map((p) => [p.role, p.offset]),
        [['bootloader', 0x0], ['partition-table', 0x8000], ['ota-data', 0xf000], ['app', 0x20000]],
      );
    }
  });

  test("writes each board's manifest: its name, four separate parts, the erase prompt, no Improv wait", () => {
    for (const [board, model] of [[LCD, 'ESP32-S3-Touch-LCD-1.46'], [AMOLED, 'ESP32-S3-Touch-AMOLED-1.8']]) {
      const manifest = JSON.parse(fs.readFileSync(path.join(site, 'firmware', board, 'manifest.json'), 'utf8'));
      const [bootloader, table, otaData, appPart] = names(board);
      assert.deepEqual(manifest, {
        name: `Grok Puck for ${model}`,
        version: '0.6.0',
        new_install_prompt_erase: true,
        new_install_improv_wait_time: 0,
        builds: [
          {
            chipFamily: 'ESP32-S3',
            parts: [
              { path: bootloader, offset: 0x0 },
              { path: table, offset: 0x8000 },
              { path: otaData, offset: 0xf000 },
              { path: appPart, offset: 0x20000 },
            ],
          },
        ],
      });
      assert.equal(
        fs.readFileSync(path.join(release, `grok-puck-0.6.0-${board}-manifest.json`), 'utf8'),
        fs.readFileSync(path.join(site, 'firmware', board, 'manifest.json'), 'utf8'),
      );
    }
  });

  test("copies each board's parts unchanged, next to its manifest on the page and into the release", () => {
    for (const { board, dir } of set) {
      const sources = FLASH_ARGS.map(([, file]) => fs.readFileSync(path.join(dir, file)));
      names(board).forEach((name, i) => {
        assert.deepEqual(fs.readFileSync(path.join(site, 'firmware', board, name)), sources[i], name);
        assert.deepEqual(fs.readFileSync(path.join(release, name)), sources[i], name);
      });
    }
  });

  test("the release holds each board's parts and manifest, one notices file, and nothing else: 11 files", () => {
    const expected = [...BOARDS.flatMap((b) => [...names(b.id), `grok-puck-0.6.0-${b.id}-manifest.json`]), 'grok-puck-0.6.0-notices.txt'];
    assert.deepEqual(fs.readdirSync(release).sort(), expected.sort());
    assert.equal(expected.length, 5 * BOARDS.length + 1, 'release.yml expects a manifest and 4 parts per board, and the notices');
  });

  test('the page: a button per board at its manifest, version filled in, nothing from another server', () => {
    const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /\{\{|\}\}/);
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'/);
    // Styles: this site, and ESP Web Tools' inline <style> blocks by their hashes (its console's,
    // without which its log lines run together); never 'unsafe-inline'.
    const ewt = path.join(site, 'esp-web-tools');
    const hashes = inlineStyleHashes(ewt);
    assert.ok(hashes.length >= 1, "ESP Web Tools' console styles itself inline");
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)[1];
    assert.ok(policy.includes(`style-src ${["'self'", ...hashes].join(' ')};`), 'style-src names each hash');
    assert.doesNotMatch(policy, /unsafe-inline|&#39;/);
    const buttons = [...html.matchAll(/<esp-web-install-button\b[^>]*\bmanifest="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(buttons, BOARDS.map((b) => `firmware/${b.id}/manifest.json`));
    for (const url of buttons) assert.ok(fs.existsSync(path.join(site, url)), `${url} is missing`);
    assert.match(html, /Install for the LCD-1\.46/);
    assert.match(html, /Install for the AMOLED-1\.8/);
    assert.match(html, /Firmware 0\.6\.0/);
    // The browser's message shows once, from the browser check; the boards' buttons have empty ones.
    const check = /<esp-web-install-button class="browser-check">([\s\S]*?)<\/esp-web-install-button>/.exec(html);
    assert.ok(check, 'the page has its browser check');
    for (const slot of ['activate', 'unsupported', 'not-allowed']) assert.match(check[1], new RegExp(`slot="${slot}"`));
    assert.match(check[1], /<p class="checking">/);
    assert.equal([...html.matchAll(/This browser can't install firmware/g)].length, 1);
    for (const [, inner] of html.matchAll(/<esp-web-install-button manifest="[^"]+">([\s\S]*?)<\/esp-web-install-button>/g)) {
      assert.match(inner, /<span slot="unsupported"><\/span>/);
      assert.match(inner, /<span slot="not-allowed"><\/span>/);
    }
    // Install is offered only where ESP Web Tools finds that it works: the steps hide otherwise.
    assert.match(html, /<ol class="steps">/);
    assert.match(fs.readFileSync(path.join(site, 'style.css'), 'utf8'), /\.install:has\(esp-web-install-button\[install-unsupported\]\) \.steps \{\s*display: none;/);
    assert.match(html, /href="https:\/\/github\.com\/e-roy\/grok-puck\/blob\/v0\.6\.0\/docs\/setup\.md#4-install-and-connect-the-device"/);
    assert.match(html, /http:\/\/192\.168\.4\.1/);
    // Scripts, styles and icons: only from this site, and each one present.
    const loaded = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(loaded.length >= 3, 'the page loads its stylesheet, icon and ESP Web Tools');
    for (const url of loaded) {
      assert.doesNotMatch(url, /^[a-z]+:|^\/\//i, `${url} must come from this site`);
      assert.ok(fs.existsSync(path.join(site, url)), `${url} is missing`);
    }
    // Plain links on the page are local files or https pages (GitHub), never http.
    for (const [, url] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      if (/^https:\/\//.test(url)) continue;
      assert.ok(fs.existsSync(path.join(site, url)), `link ${url} is missing`);
    }
    assert.ok(fs.existsSync(path.join(site, 'esp-web-tools', 'install-button.js')));
  });

  test("the LCD-1.46's card links to it on Amazon once, with the disclosure; the AMOLED-1.8's card, and the rest of the page, don't", () => {
    const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    const card = (id) => {
      const m = new RegExp(`<article class="board" aria-labelledby="${id}">([\\s\\S]*?)</article>`).exec(html);
      assert.ok(m, `the page has the card ${id}`);
      return m[1];
    };
    const lcd = card('board-lcd-146');
    const links = amazonAnchors(lcd);
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://www.amazon.com/dp/B0DS83H2V6?tag=grok-puck-20');
    assert.match(links[0].tag, /\brel="sponsored"/);
    assert.match(lcd, /Don't have one\? <a [^>]+>Buy it on Amazon<\/a>/);
    assert.equal(lcd.split(DISCLOSURE).length - 1, 1, 'the disclosure, once, next to the link');
    const amoled = card('board-amoled-18');
    assert.equal(amazonAnchors(amoled).length, 0);
    assert.doesNotMatch(amoled, /Amazon/);
    assert.equal(amazonAnchors(html).length, 1, 'no other Amazon link on the page');
    assert.equal(html.split(DISCLOSURE).length - 1, 1);
    assert.doesNotMatch(html, /\$\s?\d/, "no prices (Amazon's rules)");
  });

  test('the notices: this project, the firmware, the page and the long licence texts', () => {
    const page = fs.readFileSync(path.join(site, 'notices.txt'), 'utf8');
    const firmwareOnly = fs.readFileSync(path.join(release, 'grok-puck-0.6.0-notices.txt'), 'utf8');
    for (const text of [page, firmwareOnly]) {
      assert.match(text, /MIT License/);
      assert.match(text, /# Third-party notices: the firmware/);
      assert.match(text, /licenses\/Apache-2\.0\.txt\n\n\s+Apache License\n\s+Version 2\.0/);
      assert.match(text, /COPYING\.picolibc \(the C library; ESP-IDF's components\/esp_libc\/COPYING\.picolibc\)\n\nFormat: .*\nUpstream-Name: picolibc\n$/);
      assert.match(text, /licenses\/Montserrat-OFL\.txt/);
    }
    assert.match(page, /# Third-party notices: the installer page/);
    assert.doesNotMatch(firmwareOnly, /# Third-party notices: the installer page/);
  });

  test('the release notes: commit, page, and each board with its offsets, checksums and esptool line', () => {
    const notes = fs.readFileSync(path.join(target, 'release-notes.md'), 'utf8');
    assert.match(notes, new RegExp(`from ${'a'.repeat(40)}`));
    assert.match(notes, /for the Waveshare ESP32-S3-Touch-LCD-1\.46 and the ESP32-S3-Touch-AMOLED-1\.8/);
    assert.match(notes, /https:\/\/owner\.github\.io\/grok-puck\/ \(Chrome, Edge or Firefox 151 or newer, on a computer\), with the button for your board/);
    for (const board of [LCD, AMOLED]) {
      assert.match(notes, new RegExp(`### ESP32-S3-Touch-[^\\n]+ \\(\`${board.replaceAll('.', '\\.')}\`\\)`));
      assert.match(notes, new RegExp(`\\| \`grok-puck-0\\.6\\.0-${board.replaceAll('.', '\\.')}-app\\.bin\` \\| 0x20000 \\| 65536 \\| \`[0-9a-f]{64}\` \\|`));
      assert.match(notes, new RegExp(`esptool --chip esp32s3 write-flash 0x0 grok-puck-0\\.6\\.0-${board.replaceAll('.', '\\.')}-bootloader\\.bin 0x8000 `));
    }
  });

  test('packaging again replaces its own output', () => {
    fs.writeFileSync(path.join(site, 'stale.txt'), 'old');
    writePackage({ pack, out: target });
    assert.ok(!fs.existsSync(path.join(site, 'stale.txt')));
  });
});

describe("ESP Web Tools' inline styles, allowed by their hashes", () => {
  const web = (files) => {
    const dir = out();
    for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), code);
    return dir;
  };
  const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

  test('each <style> block is hashed as the browser sees it: JavaScript escapes turned into characters', () => {
    // As in ESP Web Tools' build: the block in a template string, with \n escapes, and ${...} after it.
    const code = 'this.attachShadow({mode:"open"}).innerHTML=`' + String.raw`\n<style>\n  .log {\n    white-space: pre-wrap;\n    content: "·\x41\\";\n  }\n</style>\n<div class="log"></div>` + '${x}`;';
    const css = '\n  .log {\n    white-space: pre-wrap;\n    content: "·A\\";\n  }\n';
    assert.deepEqual(inlineStyleHashes(web({ 'dialog.js': code, 'button.js': 'no styles here', 'notes.txt': '<style>x</style>' })), [sha(css)]);
    // The same block twice gives one hash; two blocks, two.
    assert.deepEqual(inlineStyleHashes(web({ 'a.js': code, 'b.js': code })), [sha(css)]);
    assert.equal(inlineStyleHashes(web({ 'a.js': '"<style>a</style>"', 'b.js': '"<style>b</style>"' })).length, 2);
  });

  test("refuses a <style> built at run time, or one with attributes: its hash can't be known", () => {
    assert.throws(() => inlineStyleHashes(web({ 'x.js': 'innerHTML=`<style>${css}</style>`' })), /builds an inline <style> at run time/);
    assert.throws(() => inlineStyleHashes(web({ 'x.js': '"<style nonce=x>a</style>"' })), /a <style> tag with attributes/);
  });
});

describe('refuses', () => {
  test('a merged image, or any list without the four parts', () => {
    refuses({ flashArgs: [[0x0, 'merged.bin']], files: { 'merged.bin': image(4096) } }, /doesn't list the bootloader \(1 part listed\).*never one merged image/);
    refuses({ flashArgs: FLASH_ARGS.slice(0, 3) }, /doesn't list the app \(3 parts listed\)/);
  });

  test('a part that is none of the four', () => {
    refuses({ flashArgs: [...FLASH_ARGS, [0x820000, 'storage/storage.bin']], files: { 'storage/storage.bin': Buffer.alloc(4096) } }, /storage\/storage\.bin at 0x820000, which is none of the four parts/);
  });

  test('anything that would write over NVS', () => {
    const table = (partitions) => ({ 'partition_table/partition-table.bin': partitionTable(partitions) });
    const rest = PARTITIONS.slice(3); // ota_0, ota_1, storage
    // NVS inside the sectors the OTA data is written to.
    refuses(
      { files: table([{ label: 'otadata', type: 1, subtype: 0x00, offset: 0xf000, size: 0x2000 }, { label: 'nvs', type: 1, subtype: 0x02, offset: 0x10000, size: 0x1000 }, ...rest]) },
      /the OTA boot data at 0xf000-0x11000 would overwrite partition "nvs" \(data\/nvs at 0x10000\) \(NVS: the device's Wi-Fi networks, bridge address and key\)/,
    );
    // NVS where flash_args puts the OTA data, with otadata moved elsewhere.
    refuses(
      { files: table([{ label: 'nvs', type: 1, subtype: 0x02, offset: 0xf000, size: 0x2000 }, { label: 'otadata', type: 1, subtype: 0x00, offset: 0x11000, size: 0x2000 }, ...rest]) },
      /the OTA boot data at 0xf000 is not at the otadata partition/,
    );
    // An otadata partition smaller than the OTA data, with NVS right after it.
    refuses(
      { files: table([{ label: 'otadata', type: 1, subtype: 0x00, offset: 0xf000, size: 0x1000 }, { label: 'nvs', type: 1, subtype: 0x02, offset: 0x10000, size: 0x6000 }, ...rest]) },
      /the OTA boot data \(8192 bytes\) is larger than its partition "otadata"/,
    );
    // NVS starting inside the sector the partition table is written to.
    refuses({ files: table([{ label: 'nvs', type: 1, subtype: 0x02, offset: 0x8c00, size: 0x6400 }, ...PARTITIONS.slice(1)]) }, /the partition table at 0x8000 reaches the first partition at 0x8c00/);
    // An app that runs past the end of its partition into NVS.
    refuses(
      { files: table([...PARTITIONS.slice(0, 3), { label: 'ota_0', type: 0, subtype: 0x10, offset: 0x20000, size: 0x10000 }, { label: 'nvs2', type: 1, subtype: 0x02, offset: 0x30000, size: 0x6000 }]), appSize: 0x10001 },
      /the app \(65537 bytes\) is larger than its partition "ota_0"/,
    );
    // The same checks for the other board.
    refuses({ board: AMOLED, files: table([{ label: 'nvs', type: 1, subtype: 0x02, offset: 0x8c00, size: 0x6400 }, ...PARTITIONS.slice(1)]) }, /the partition table at 0x8000 reaches the first partition at 0x8c00/);
  });

  test('a part that reaches into a partition other than its own', () => {
    const overlapping = partitionTable([...PARTITIONS.slice(0, 3), { label: 'ota_0', type: 0, subtype: 0x10, offset: 0x20000, size: 0x400000 }, { label: 'cfg', type: 1, subtype: 0x82, offset: 0x30000, size: 0x1000 }]);
    refuses({ files: { 'partition_table/partition-table.bin': overlapping }, appSize: 0x10001 }, /the app at 0x20000-0x31000 would overwrite partition "cfg" \(data\/spiffs at 0x30000\)$/);
  });

  test('a bootloader that reaches the partition table', () => {
    refuses({ files: { 'bootloader/bootloader.bin': image(0x8001) } }, /the bootloader .* reaches the partition table/);
  });

  test('an app not at the partition the bootloader starts', () => {
    refuses({ flashArgs: [...FLASH_ARGS.slice(0, 3), [0x420000, 'desk_display.bin']] }, /not at the partition the bootloader starts/);
  });

  test('a version other than the one asked for, or one unfit for file names', () => {
    refuses({}, /reports version 0\.6\.0, not 0\.7\.0/, { version: '0.7.0' });
    refuses({ version: '../x' }, /can't be used in file names/);
  });

  test("files that are not ESP images, or for a chip ESP Web Tools can't flash", () => {
    refuses({ files: { 'desk_display.bin': Buffer.alloc(4096) } }, /the app is not an ESP image/);
    refuses({ chip: 0x0019 }, /chip ID 0x19, which ESP Web Tools can't flash/);
    refuses({ files: { 'desk_display.bin': app({ chip: 0x0005 }) } }, /different chips/);
    refuses({ files: { 'desk_display.bin': image(4096) } }, /no app descriptor/);
  });

  test('a build packaged as another board than the one its app names, or naming none or two', () => {
    refuses({ board: AMOLED, names: [LCD] }, /packaged as waveshare-amoled-1\.8, but its app names waveshare-lcd-1\.46: build it with -D BOARD=waveshare-amoled-1\.8/);
    refuses({ board: LCD, names: [] }, /packaged as waveshare-lcd-1\.46, but its app names no board/);
    refuses({ board: LCD, names: [LCD, AMOLED] }, /its app names waveshare-lcd-1\.46 and waveshare-amoled-1\.8/);
    assert.throws(() => readFirmware(build(), { board: 'someone-else-2.0' }), /there is no board "someone-else-2\.0": the boards are waveshare-lcd-1\.46, waveshare-amoled-1\.8/);
  });

  test("a set of builds that isn't one per board, or not of one version and ESP-IDF", () => {
    const [lcd, amoled] = builds();
    refusesSet([lcd], /no build for waveshare-amoled-1\.8: every board's build is packaged/);
    refusesSet([lcd, amoled, { board: LCD, dir: lcd.dir }], /waveshare-lcd-1\.46 is given more than once/);
    refusesSet([lcd, amoled, { board: 'someone-else-2.0', dir: lcd.dir }], /there is no board "someone-else-2\.0"/);
    refusesSet(builds({ [AMOLED]: { version: '0.6.1' } }), /waveshare-amoled-1\.8 reports version 0\.6\.1, waveshare-lcd-1\.46 0\.6\.0/);
    refusesSet(builds({ [AMOLED]: { idf: 'v6.2' } }), /built with ESP-IDF v6\.2, waveshare-lcd-1\.46 with v6\.1/);
    // The release passes its version: every board must report it.
    refusesSet([lcd, amoled], /reports version 0\.6\.0, not 0\.6\.2/, { version: '0.6.2' });
  });

  test('a missing build folder, flash_args or part', () => {
    assert.throws(() => readFirmware(path.join(out(), 'nothing'), { board: LCD }), /flash_args not found/);
    refuses({ files: { 'ota_data_initial.bin': null } }, /ota_data_initial\.bin is listed in flash_args but missing/);
  });

  test("builds without the C library's licence, unless ESP-IDF has it", () => {
    const saved = process.env.IDF_PATH;
    try {
      delete process.env.IDF_PATH;
      refusesSet(builds({ [LCD]: { files: { 'COPYING.picolibc': null } } }), /COPYING\.picolibc, is needed for the notices/);
      // In the ESP-IDF environment, the file comes from $IDF_PATH.
      const idf = out();
      fs.mkdirSync(path.join(idf, 'components', 'esp_libc'), { recursive: true });
      fs.writeFileSync(path.join(idf, 'components', 'esp_libc', 'COPYING.picolibc'), 'from ESP-IDF');
      process.env.IDF_PATH = idf;
      assert.equal(readFirmwares(builds({ [LCD]: { files: { 'COPYING.picolibc': null } } })).picolibc, path.join(idf, 'components', 'esp_libc', 'COPYING.picolibc'));
    } finally {
      if (saved === undefined) delete process.env.IDF_PATH;
      else process.env.IDF_PATH = saved;
    }
  });

  test('an output folder it did not make', () => {
    const target = out();
    fs.writeFileSync(path.join(target, 'keep.txt'), 'not ours');
    assert.throws(() => writePackage({ pack: readFirmwares(builds()), out: target }), /wasn't made by this script/);
    assert.ok(fs.existsSync(path.join(target, 'keep.txt')));
  });

  test('a --build that is not <board>=<folder>', () => {
    assert.deepEqual(parseBuild(`${AMOLED}=C:\\b\\amoled18`), { board: AMOLED, dir: path.resolve('C:\\b\\amoled18') });
    for (const bad of ['C:\\b\\amoled18', `${AMOLED}=`, '=x']) assert.throws(() => parseBuild(bad), /--build takes <board>=<build folder>/);
  });
});

describe('the command line', () => {
  test('packages a build per board and says what it wrote', () => {
    const target = path.join(out(), 'dist');
    const args = builds().flatMap(({ board, dir }) => ['--build', `${board}=${dir}`]);
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args, '--out', target, '--version', '0.6.0'], { encoding: 'utf8' });
    assert.match(stdout, /Grok Puck 0\.6\.0 \(ESP-IDF v6\.1\)/);
    assert.match(stdout, /waveshare-amoled-1\.8, for ESP32-S3/);
    assert.match(stdout, /0x20000 +grok-puck-0\.6\.0-waveshare-lcd-1\.46-app\.bin/);
    assert.ok(fs.existsSync(path.join(target, 'site', 'index.html')));
  });

  test('fails with a message, and exit code 1, on a bad build', () => {
    const [lcd, amoled] = builds({ [LCD]: { flashArgs: FLASH_ARGS.slice(1) } });
    const result = spawnSync(process.execPath, [SCRIPT, '--build', `${lcd.board}=${lcd.dir}`, '--build', `${amoled.board}=${amoled.dir}`, '--out', path.join(out(), 'dist')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^package: flash_args doesn't list the bootloader/);
  });

  test('says how to use it without --build, and refuses unknown options', () => {
    const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /^package: usage: node scripts\/package\.mjs --build waveshare-lcd-1\.46=<build folder> --build waveshare-amoled-1\.8=<build folder>/);
    const result = spawnSync(process.execPath, [SCRIPT, '--bild', 'x'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^package: Unknown option '--bild'/);
  });
});
