// The packaging script on fixture builds: what it writes for a good build, and every way it refuses
// one (above all, anything that would write over NVS, where the device keeps its settings).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLASH_ARGS, PARTITIONS, app, image, makeBuild, partitionTable, tempDir } from './fixture.mjs';
import { PackageError, readFirmware, writePackage } from '../scripts/package.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/package.mjs', import.meta.url));
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

const refuses = (options, message, read = {}) =>
  assert.throws(() => readFirmware(build(options), read), (err) => err instanceof PackageError && message.test(err.message));

describe('a good build', () => {
  const dir = build();
  const target = path.join(out(), 'dist');
  const firmware = readFirmware(dir, { version: '0.6.0' });
  writePackage({ firmware, out: target, commit: 'a'.repeat(40), pageUrl: 'https://owner.github.io/grok-puck/' });
  const site = path.join(target, 'site');
  const release = path.join(target, 'release');
  const names = ['bootloader', 'partition-table', 'ota-data', 'app'].map((r) => `grok-puck-0.6.0-${r}.bin`);

  test('reads the version, the chip and the four parts in flash order', () => {
    assert.equal(firmware.version, '0.6.0');
    assert.equal(firmware.chipFamily, 'ESP32-S3');
    assert.deepEqual(
      firmware.parts.map((p) => [p.role, p.offset]),
      [['bootloader', 0x0], ['partition-table', 0x8000], ['ota-data', 0xf000], ['app', 0x20000]],
    );
  });

  test('writes the manifest: four separate parts, the erase prompt, no Improv wait', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(site, 'firmware', 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, {
      name: 'Grok Puck',
      version: '0.6.0',
      new_install_prompt_erase: true,
      new_install_improv_wait_time: 0,
      builds: [
        {
          chipFamily: 'ESP32-S3',
          parts: [
            { path: names[0], offset: 0x0 },
            { path: names[1], offset: 0x8000 },
            { path: names[2], offset: 0xf000 },
            { path: names[3], offset: 0x20000 },
          ],
        },
      ],
    });
    assert.equal(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8'), fs.readFileSync(path.join(site, 'firmware', 'manifest.json'), 'utf8'));
  });

  test('copies each part unchanged, to the page and to the release', () => {
    const sources = FLASH_ARGS.map(([, file]) => fs.readFileSync(path.join(dir, file)));
    names.forEach((name, i) => {
      assert.deepEqual(fs.readFileSync(path.join(site, 'firmware', name)), sources[i], name);
      assert.deepEqual(fs.readFileSync(path.join(release, name)), sources[i], name);
    });
  });

  test('the release holds the parts, the manifest and the notices, and nothing else', () => {
    assert.deepEqual(fs.readdirSync(release).sort(), [...names, 'grok-puck-0.6.0-notices.txt', 'manifest.json'].sort());
  });

  test('the page: version filled in, every local file present, nothing from another server', () => {
    const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /\{\{|\}\}/);
    assert.match(html, /Install Grok Puck 0\.6\.0/);
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'/);
    assert.match(html, /<esp-web-install-button manifest="firmware\/manifest.json">/);
    for (const slot of ['activate', 'unsupported', 'not-allowed']) assert.match(html, new RegExp(`slot="${slot}"`));
    // Install is offered only where ESP Web Tools finds that it works: the steps hide otherwise.
    assert.match(html, /<ol class="steps">/);
    assert.match(html, /<p class="checking">/);
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

  test('the release notes: commit, page, offsets and checksums', () => {
    const notes = fs.readFileSync(path.join(target, 'release-notes.md'), 'utf8');
    assert.match(notes, new RegExp(`from ${'a'.repeat(40)}`));
    assert.match(notes, /https:\/\/owner\.github\.io\/grok-puck\/ \(Chrome, Edge or Firefox 151 or newer, on a computer\)/);
    assert.match(notes, /\| `grok-puck-0\.6\.0-app\.bin` \| 0x20000 \| 65536 \| `[0-9a-f]{64}` \|/);
    assert.match(notes, /esptool --chip esp32s3 write-flash 0x0 grok-puck-0\.6\.0-bootloader\.bin 0x8000 /);
  });

  test('packaging again replaces its own output', () => {
    fs.writeFileSync(path.join(site, 'stale.txt'), 'old');
    writePackage({ firmware, out: target });
    assert.ok(!fs.existsSync(path.join(site, 'stale.txt')));
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

  test('files that are not ESP images, or for a chip ESP Web Tools can\'t flash', () => {
    refuses({ files: { 'desk_display.bin': Buffer.alloc(4096) } }, /the app is not an ESP image/);
    refuses({ chip: 0x0019 }, /chip ID 0x19, which ESP Web Tools can't flash/);
    refuses({ files: { 'desk_display.bin': app({ chip: 0x0005 }) } }, /different chips/);
    refuses({ files: { 'desk_display.bin': image(4096) } }, /no app descriptor/);
  });

  test('a missing build folder, flash_args or part', () => {
    assert.throws(() => readFirmware(path.join(out(), 'nothing')), /flash_args not found/);
    refuses({ files: { 'ota_data_initial.bin': null } }, /ota_data_initial\.bin is listed in flash_args but missing/);
  });

  test("a build without the C library's licence, unless ESP-IDF has it", () => {
    const saved = process.env.IDF_PATH;
    try {
      delete process.env.IDF_PATH;
      refuses({ files: { 'COPYING.picolibc': null } }, /COPYING\.picolibc, is needed for the notices/);
      // In the ESP-IDF environment, the file comes from $IDF_PATH.
      const idf = out();
      fs.mkdirSync(path.join(idf, 'components', 'esp_libc'), { recursive: true });
      fs.writeFileSync(path.join(idf, 'components', 'esp_libc', 'COPYING.picolibc'), 'from ESP-IDF');
      process.env.IDF_PATH = idf;
      assert.equal(readFirmware(build({ files: { 'COPYING.picolibc': null } })).picolibc, path.join(idf, 'components', 'esp_libc', 'COPYING.picolibc'));
    } finally {
      if (saved === undefined) delete process.env.IDF_PATH;
      else process.env.IDF_PATH = saved;
    }
  });

  test('an output folder it did not make', () => {
    const target = out();
    fs.writeFileSync(path.join(target, 'keep.txt'), 'not ours');
    assert.throws(() => writePackage({ firmware: readFirmware(build()), out: target }), /wasn't made by this script/);
    assert.ok(fs.existsSync(path.join(target, 'keep.txt')));
  });
});

describe('the command line', () => {
  test('packages a build and says what it wrote', () => {
    const target = path.join(out(), 'dist');
    const stdout = execFileSync(process.execPath, [SCRIPT, '--build', build(), '--out', target, '--version', '0.6.0'], { encoding: 'utf8' });
    assert.match(stdout, /Grok Puck 0\.6\.0 for ESP32-S3/);
    assert.match(stdout, /0x20000 +grok-puck-0\.6\.0-app\.bin/);
    assert.ok(fs.existsSync(path.join(target, 'site', 'index.html')));
  });

  test('fails with a message, and exit code 1, on a bad build', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--build', build({ flashArgs: FLASH_ARGS.slice(1) }), '--out', path.join(out(), 'dist')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^package: flash_args doesn't list the bootloader/);
  });

  test('refuses unknown options', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--bild', 'x'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^package: Unknown option '--bild'/);
  });
});
