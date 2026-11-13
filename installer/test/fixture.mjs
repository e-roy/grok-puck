// Writes a small ESP-IDF build folder for the tests: flash_args and the four parts it lists, with real
// headers (ESP image, app descriptor, partition table) and filler for the rest. The defaults match
// firmware/partitions.csv and firmware/build/flash_args.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PARTITIONS = [
  { label: 'nvs', type: 1, subtype: 0x02, offset: 0x9000, size: 0x6000 },
  { label: 'otadata', type: 1, subtype: 0x00, offset: 0xf000, size: 0x2000 },
  { label: 'phy_init', type: 1, subtype: 0x01, offset: 0x11000, size: 0x1000 },
  { label: 'ota_0', type: 0, subtype: 0x10, offset: 0x20000, size: 0x400000 },
  { label: 'ota_1', type: 0, subtype: 0x11, offset: 0x420000, size: 0x400000 },
  { label: 'storage', type: 1, subtype: 0x82, offset: 0x820000, size: 0x7e0000 },
];

export const FLASH_ARGS = [
  [0x0, 'bootloader/bootloader.bin'],
  [0x8000, 'partition_table/partition-table.bin'],
  [0xf000, 'ota_data_initial.bin'],
  [0x20000, 'desk_display.bin'],
];

/** An ESP image: the 24-byte header (magic 0xE9, chip ID at byte 12), then filler. */
export function image(size, chip = 0x0009) {
  const data = Buffer.alloc(size, 0x5a);
  data.fill(0, 0, 24);
  data[0] = 0xe9;
  data[1] = 1;
  data.writeUInt16LE(chip, 12);
  return data;
}

/** An app image with its app descriptor (esp_app_desc_t) after the image and segment headers. */
export function app({ version = '0.6.0', chip = 0x0009, size = 64 * 1024, project = 'desk_display' } = {}) {
  const data = image(size, chip);
  const at = 24 + 8;
  data.fill(0, at, at + 256);
  data.writeUInt32LE(0xabcd5432, at);
  data.write(version, at + 16, 'latin1');
  data.write(project, at + 48, 'latin1');
  data.write('v6.1', at + 112, 'latin1');
  return data;
}

/** A binary partition table: 32-byte entries, the MD5 entry, then 0xFF up to 0xC00 bytes. */
export function partitionTable(partitions = PARTITIONS) {
  const data = Buffer.alloc(0xc00, 0xff);
  partitions.forEach((p, i) => {
    const at = i * 32;
    data.writeUInt16LE(0x50aa, at);
    data[at + 2] = p.type;
    data[at + 3] = p.subtype;
    data.writeUInt32LE(p.offset, at + 4);
    data.writeUInt32LE(p.size, at + 8);
    data.fill(0, at + 12, at + 28);
    data.write(p.label, at + 12, 'latin1');
    data.writeUInt32LE(0, at + 28);
  });
  const md5 = partitions.length * 32;
  data.writeUInt16LE(0xebeb, md5);
  return data;
}

/**
 * Writes a build folder and returns its path. `files` replaces or adds files by their path in the
 * build; `flashArgs` replaces the parts flash_args lists.
 */
export function makeBuild({ flashArgs = FLASH_ARGS, files = {}, version, chip, appSize } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-puck-build-'));
  const all = {
    'bootloader/bootloader.bin': image(22608, chip),
    'partition_table/partition-table.bin': partitionTable(),
    'ota_data_initial.bin': Buffer.alloc(0x2000, 0xff),
    'desk_display.bin': app({ version, chip, size: appSize }),
    // What CI copies from ESP-IDF next to the build: the C library's licence file.
    'COPYING.picolibc': Buffer.from('Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: picolibc\n'),
    ...files,
  };
  for (const [name, data] of Object.entries(all)) {
    if (data === null) continue;
    fs.mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  const lines = ['--flash-mode dio --flash-freq 80m --flash-size 16MB', ...flashArgs.map(([o, f]) => `0x${o.toString(16)} ${f}`)];
  fs.writeFileSync(path.join(dir, 'flash_args'), `${lines.join('\n')}\n`);
  return dir;
}

export function tempDir(prefix = 'grok-puck-out-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
