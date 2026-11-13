// Packages a firmware build for the web installer page and for a GitHub Release. The release
// workflow (.github/workflows/release.yml) runs it on the build it just made; CI runs it on every pull
// request; it runs the same way locally.
//
//   node scripts/package.mjs --build <firmware build folder> [options]
//
//   --build <dir>       an ESP-IDF build folder (firmware/build). Its flash_args says which parts
//                       `idf.py flash` writes, and where. Required. The C library's licence
//                       (COPYING.picolibc) comes from this folder, where CI copies it, or else from
//                       the ESP-IDF in $IDF_PATH.
//   --out <dir>         where to write (default: dist). Emptied first, but only if this script made it.
//   --version <x.y.z>   refuse unless the app reports this version (the release passes PROJECT_VER).
//   --commit <sha>      the commit that was built, named in the release notes.
//   --repo <url>        the repository, for the page's links (default: the upstream repository).
//   --page-url <url>    the installer page's address, for the release notes.
//
// It writes:
//   <out>/site/              the installer page, for GitHub Pages: the page, ESP Web Tools (copied from
//                            node_modules, so the page loads nothing from another server), the
//                            manifest and the four parts under firmware/, and the licence notices;
//   <out>/release/           the files attached to the GitHub Release: the four parts, the manifest and
//                            the licence notices;
//   <out>/release-notes.md   the release's description.
//
// The four parts (bootloader, partition table, OTA data, app) are written separately, each at its own
// offset, and never as one merged image: a merged image also covers NVS (0x9000-0xf000 today), where
// the device keeps its Wi-Fi networks, bridge address and key, and would fill it with blank bytes. The
// script checks that against the build's own partition table: no part may reach into any partition
// but its own, counted in whole 4 KB flash sectors, since writing erases whole sectors.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const INSTALLER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(INSTALLER, '..');
const DEFAULT_REPO = 'https://github.com/e-roy/grok-puck';
const NAME = 'Grok Puck';
const FILE_PREFIX = 'grok-puck';
const SECTOR = 0x1000;
// The marker that lets the script empty an output folder it made itself, and no other.
const MARKER = '.grok-puck-package';

// ESP image header chip IDs (ESP-IDF's esp_app_format.h) for the chips ESP Web Tools can flash.
const CHIP_FAMILIES = new Map([
  [0x0000, 'ESP32'],
  [0x0002, 'ESP32-S2'],
  [0x0005, 'ESP32-C3'],
  [0x0009, 'ESP32-S3'],
  [0x000c, 'ESP32-C2'],
  [0x000d, 'ESP32-C6'],
  [0x0010, 'ESP32-H2'],
  [0x0012, 'ESP32-P4'],
  [0x0014, 'ESP32-C61'],
  [0x0017, 'ESP32-C5'],
]);

// What flash_args lists for this project, in the names the published files get.
const ROLES = [
  { role: 'bootloader', what: 'the bootloader', file: (f) => f === 'bootloader/bootloader.bin' },
  { role: 'partition-table', what: 'the partition table', file: (f) => f === 'partition_table/partition-table.bin' },
  { role: 'ota-data', what: 'the OTA boot data', file: (f) => f === 'ota_data_initial.bin' },
  { role: 'app', what: 'the app', file: (f) => /^[^/]+\.bin$/.test(f) && f !== 'ota_data_initial.bin' },
];

const PARTITION_TYPES = { 0: 'app', 1: 'data' };
const DATA_SUBTYPES = { 0x00: 'ota', 0x01: 'phy', 0x02: 'nvs', 0x03: 'coredump', 0x04: 'nvs_keys', 0x81: 'fat', 0x82: 'spiffs', 0x83: 'littlefs' };

export class PackageError extends Error {}

function fail(message) {
  throw new PackageError(message);
}

const hex = (n) => `0x${n.toString(16)}`;
const roundUp = (n) => Math.ceil(n / SECTOR) * SECTOR;

/** The parts `idf.py flash` writes, from the build's flash_args: [{ offset, file }]. */
export function readFlashArgs(buildDir) {
  const file = path.join(buildDir, 'flash_args');
  if (!fs.existsSync(file)) fail(`${file} not found: is ${buildDir} an ESP-IDF build folder (run idf.py build first)?`);
  const parts = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('-')) continue; // the options line: --flash-mode, --flash-size...
    const m = /^(0x[0-9a-f]+)\s+(\S+)$/i.exec(line);
    if (!m) fail(`flash_args: unexpected line "${line}"`);
    parts.push({ offset: Number.parseInt(m[1], 16), file: m[2].replaceAll('\\', '/') });
  }
  if (!parts.length) fail('flash_args lists no parts');
  return parts;
}

/** An ESP image's chip ID, after checking its header. */
function imageChip(data, what) {
  if (data.length < 24 || data[0] !== 0xe9) fail(`${what} is not an ESP image (no 0xE9 header)`);
  const chip = data.readUInt16LE(12);
  if (!CHIP_FAMILIES.has(chip)) fail(`${what} is for chip ID ${hex(chip)}, which ESP Web Tools can't flash`);
  return chip;
}

const cString = (data, start, length) => {
  const bytes = data.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString('latin1');
};

/** The app descriptor (esp_app_desc_t) right after the image and first segment headers. */
export function readAppDescriptor(data) {
  const at = 24 + 8;
  if (data.length < at + 256 || data.readUInt32LE(at) !== 0xabcd5432) fail('the app has no app descriptor (magic word 0xABCD5432)');
  return {
    version: cString(data, at + 16, 32),
    project: cString(data, at + 48, 32),
    idf: cString(data, at + 112, 32),
  };
}

/** The partitions in a binary partition table: [{ label, type, subtype, offset, size }]. */
export function readPartitionTable(data) {
  const partitions = [];
  for (let at = 0; at + 32 <= data.length; at += 32) {
    const magic = data.readUInt16LE(at);
    if (magic === 0xffff || magic === 0xebeb) break; // the end, or the MD5 entry that follows the last
    if (magic !== 0x50aa) fail(`the partition table has an unknown entry at byte ${at}`);
    partitions.push({
      type: data[at + 2],
      subtype: data[at + 3],
      offset: data.readUInt32LE(at + 4),
      size: data.readUInt32LE(at + 8),
      label: cString(data, at + 12, 16),
    });
  }
  if (!partitions.length) fail('the partition table is empty');
  return partitions;
}

const kind = (p) =>
  p.type === 1 ? `data/${DATA_SUBTYPES[p.subtype] ?? hex(p.subtype)}` : `${PARTITION_TYPES[p.type] ?? hex(p.type)}/${hex(p.subtype)}`;

/** Checks that writing the parts touches nothing but their own places, NVS above all. */
export function checkLayout(parts, partitions) {
  const by = Object.fromEntries(parts.map((p) => [p.role, p]));
  const tableOffset = by['partition-table'].offset;
  const first = Math.min(...partitions.map((p) => p.offset));
  for (const part of parts) {
    if (part.offset % SECTOR) fail(`${part.what} starts at ${hex(part.offset)}, not on a 4 KB flash sector`);
  }
  if (roundUp(by.bootloader.offset + by.bootloader.data.length) > tableOffset) {
    fail(`the bootloader (${by.bootloader.data.length} bytes at ${hex(by.bootloader.offset)}) reaches the partition table at ${hex(tableOffset)}`);
  }
  if (tableOffset + SECTOR > first) fail(`the partition table at ${hex(tableOffset)} reaches the first partition at ${hex(first)}`);

  // The OTA data goes in the otadata partition; the app in the partition the bootloader starts when
  // the OTA data is blank, as it is after an install: factory if there is one, else ota_0.
  const otadata = partitions.find((p) => p.type === 1 && p.subtype === 0x00);
  if (!otadata || otadata.offset !== by['ota-data'].offset) fail(`${by['ota-data'].what} at ${hex(by['ota-data'].offset)} is not at the otadata partition`);
  const boots = partitions.find((p) => p.type === 0 && p.subtype === 0x00) ?? partitions.find((p) => p.type === 0 && p.subtype === 0x10);
  if (!boots || boots.offset !== by.app.offset) fail(`${by.app.what} at ${hex(by.app.offset)} is not at the partition the bootloader starts (factory or ota_0)`);
  const home = new Map([
    ['ota-data', otadata],
    ['app', boots],
  ]);

  for (const part of parts) {
    const start = part.offset;
    const end = roundUp(part.offset + part.data.length);
    const own = home.get(part.role);
    if (own && end > own.offset + own.size) fail(`${part.what} (${part.data.length} bytes) is larger than its partition "${own.label}" (${own.size} bytes)`);
    for (const p of partitions) {
      if (p === own || end <= p.offset || start >= p.offset + p.size) continue;
      const nvs = p.type === 1 && p.subtype === 0x02 ? " (NVS: the device's Wi-Fi networks, bridge address and key)" : '';
      fail(`${part.what} at ${hex(start)}-${hex(end)} would overwrite partition "${p.label}" (${kind(p)} at ${hex(p.offset)})${nvs}`);
    }
  }
}

/** Reads and checks a firmware build: its version, chip and the four parts in flash order. */
export function readFirmware(buildDir, { version: expected } = {}) {
  const listed = readFlashArgs(buildDir);
  const parts = [];
  for (const entry of listed) {
    const role = ROLES.find((r) => r.file(entry.file) && !parts.some((p) => p.role === r.role));
    if (!role) fail(`flash_args lists ${entry.file} at ${hex(entry.offset)}, which is none of the four parts (bootloader, partition table, OTA data, app)`);
    const file = path.join(buildDir, entry.file);
    if (!fs.existsSync(file)) fail(`${entry.file} is listed in flash_args but missing from ${buildDir}`);
    parts.push({ ...entry, role: role.role, what: role.what, data: fs.readFileSync(file) });
  }
  for (const role of ROLES) {
    if (!parts.some((p) => p.role === role.role)) fail(`flash_args doesn't list ${role.what} (${listed.length} part${listed.length === 1 ? '' : 's'} listed): the installer needs the four parts separately, never one merged image`);
  }
  const by = Object.fromEntries(parts.map((p) => [p.role, p]));

  const chip = imageChip(by.bootloader.data, 'the bootloader');
  if (imageChip(by.app.data, 'the app') !== chip) fail('the bootloader and the app are built for different chips');
  const app = readAppDescriptor(by.app.data);
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,30}$/.test(app.version)) fail(`the app's version "${app.version}" can't be used in file names`);
  if (expected !== undefined && app.version !== expected) fail(`the app reports version ${app.version}, not ${expected}`);
  if (by['ota-data'].data.length !== 2 * SECTOR) fail(`the OTA boot data is ${by['ota-data'].data.length} bytes, not ${2 * SECTOR}`);

  checkLayout(parts, readPartitionTable(by['partition-table'].data));
  return { version: app.version, project: app.project, idf: app.idf, chipFamily: CHIP_FAMILIES.get(chip), parts, picolibc: picolibcLicence(buildDir) };
}

/**
 * The C library's licence file (picolibc: its copyright holders and licences, file by file), from the
 * ESP-IDF that built the firmware. It isn't kept in the repository: CI copies it into the build folder,
 * and locally it comes from $IDF_PATH (the ESP-IDF environment).
 */
function picolibcLicence(buildDir) {
  const candidates = [path.join(buildDir, 'COPYING.picolibc')];
  if (process.env.IDF_PATH) candidates.push(path.join(process.env.IDF_PATH, 'components', 'esp_libc', 'COPYING.picolibc'));
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    fail("the C library's licence, ESP-IDF's components/esp_libc/COPYING.picolibc, is needed for the notices: copy it into the build folder, or run this in the ESP-IDF environment (IDF_PATH set)");
  }
  return found;
}

const partName = (version, role) => `${FILE_PREFIX}-${version}-${role}.bin`;

/** The ESP Web Tools manifest. Part paths are relative to the manifest, which sits next to them. */
export function manifest(firmware) {
  return {
    name: NAME,
    version: firmware.version,
    // Offer "Erase device" for a clean start; left unticked, an install keeps NVS (the settings).
    new_install_prompt_erase: true,
    // The firmware doesn't speak Improv Wi-Fi: don't wait for it after an install.
    new_install_improv_wait_time: 0,
    builds: [
      {
        chipFamily: firmware.chipFamily,
        parts: firmware.parts.map((p) => ({ path: partName(firmware.version, p.role), offset: p.offset })),
      },
    ],
  };
}

function prepareOut(out) {
  if (fs.existsSync(out)) {
    const entries = fs.readdirSync(out);
    if (!entries.includes(MARKER) && entries.length) fail(`${out} exists and wasn't made by this script: remove it, or choose another --out`);
    // The marker stays, so a clean-up that fails halfway (a file in use) can be finished next time.
    for (const entry of entries) if (entry !== MARKER) fs.rmSync(path.join(out, entry), { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, MARKER), 'Made by installer/scripts/package.mjs, which empties this folder each time.\n');
}

function espWebTools() {
  const dir = fs.realpathSync(path.join(INSTALLER, 'node_modules', 'esp-web-tools'));
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const web = path.join(dir, 'dist', 'web');
  if (!fs.existsSync(path.join(web, 'install-button.js'))) fail(`ESP Web Tools ${version} has no dist/web/install-button.js`);
  return { version, web };
}

const text = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();

/**
 * The licence notices: this project's licence, the firmware's notices (and the page's), then the
 * longer licence texts they point to (firmware/licenses/ and the C library's, from ESP-IDF).
 */
function notices({ version, withPage, ewt, picolibc }) {
  const rule = '='.repeat(100);
  const sections = [
    `${NAME} ${version}: licences\n\nThe ${withPage ? 'firmware and this installer page are' : 'firmware is'} MIT-licensed (below), and contain${withPage ? '' : 's'} third-party software under its own licences, listed after it. Links to licenses/... name the texts at the end of this file.`,
    `${NAME}\n\n${text(path.join(REPO_ROOT, 'LICENSE'))}`,
    text(path.join(REPO_ROOT, 'firmware', 'NOTICES.md')),
  ];
  if (withPage) sections.push(`${text(path.join(INSTALLER, 'NOTICES.md'))}\n\n(This page carries ESP Web Tools ${ewt}.)`);
  const licenses = path.join(REPO_ROOT, 'firmware', 'licenses');
  for (const file of fs.readdirSync(licenses).filter((f) => f.endsWith('.txt')).sort()) {
    sections.push(`licenses/${file}\n\n${text(path.join(licenses, file))}`);
  }
  sections.push(`COPYING.picolibc (the C library; ESP-IDF's components/esp_libc/COPYING.picolibc)\n\n${text(picolibc)}`);
  return `${sections.join(`\n\n${rule}\n\n`)}\n`;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function writePage({ site, firmware, repo, ewt }) {
  const page = path.join(INSTALLER, 'page');
  fs.cpSync(page, site, { recursive: true });
  const values = {
    VERSION: firmware.version,
    REPO: repo,
    RELEASE_URL: `${repo}/releases/tag/v${firmware.version}`,
    SOURCE_URL: `${repo}/tree/v${firmware.version}`,
    SETUP_URL: `${repo}/blob/v${firmware.version}/docs/setup.md#4-install-and-connect-the-device`,
    ESP_WEB_TOOLS_VERSION: ewt.version,
  };
  const html = fs.readFileSync(path.join(page, 'index.html'), 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
    if (!(key in values)) fail(`page/index.html has an unknown placeholder ${all}`);
    return escapeHtml(values[key]);
  });
  fs.writeFileSync(path.join(site, 'index.html'), html);
  fs.cpSync(ewt.web, path.join(site, 'esp-web-tools'), { recursive: true });
}

function releaseNotes({ firmware, repo, commit, pageUrl }) {
  const v = firmware.version;
  const lines = [
    `${NAME} firmware **${v}** for the Waveshare ESP32-S3-Touch-LCD-1.46${commit ? `, built by GitHub Actions from ${commit}` : ''} with ESP-IDF ${firmware.idf}.`,
    '',
    `**Install it from the browser:** ${pageUrl ?? 'the installer page'} (Chrome, Edge or Firefox 151 or newer, on a computer). An install keeps the device's Wi-Fi networks, bridge address and key; tick **Erase device** in the installer for a clean start. Setting up a whole desk: [docs/setup.md](${repo}/blob/v${v}/docs/setup.md).`,
    '',
    '| File | Flash offset | Size (bytes) | SHA-256 |',
    '|---|---|---|---|',
    ...firmware.parts.map((p) => `| \`${partName(v, p.role)}\` | ${hex(p.offset)} | ${p.data.length} | \`${createHash('sha256').update(p.data).digest('hex')}\` |`),
    '',
    `\`manifest.json\` is the installer's manifest (ESP Web Tools). \`${FILE_PREFIX}-${v}-notices.txt\` lists the licences of everything the firmware contains.`,
    '',
    'To flash these files without the browser (esptool 5), which keeps the settings the same way:',
    '',
    '```sh',
    `esptool --chip ${firmware.chipFamily.toLowerCase().replace('-', '')} write-flash ${firmware.parts.map((p) => `${hex(p.offset)} ${partName(v, p.role)}`).join(' ')}`,
    '```',
    '',
  ];
  return lines.join('\n');
}

/** Writes the page, the release files and the release notes for a checked firmware build. */
export function writePackage({ firmware, out, repo = DEFAULT_REPO, commit, pageUrl }) {
  if (!/^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._-]+)+$/.test(repo)) fail(`--repo must be an https address such as ${DEFAULT_REPO}`);
  if (commit !== undefined && !/^[0-9a-f]{7,40}$/.test(commit)) fail('--commit must be a commit SHA');
  if (pageUrl !== undefined && !/^https?:\/\/\S+$/.test(pageUrl)) fail('--page-url must be an http(s) address');
  const ewt = espWebTools();
  prepareOut(out);
  const site = path.join(out, 'site');
  const release = path.join(out, 'release');
  const siteFirmware = path.join(site, 'firmware');
  fs.mkdirSync(siteFirmware, { recursive: true });
  fs.mkdirSync(release, { recursive: true });

  const json = `${JSON.stringify(manifest(firmware), null, 2)}\n`;
  for (const dir of [siteFirmware, release]) {
    for (const p of firmware.parts) fs.writeFileSync(path.join(dir, partName(firmware.version, p.role)), p.data);
    fs.writeFileSync(path.join(dir, 'manifest.json'), json);
  }
  writePage({ site, firmware, repo, ewt });
  fs.writeFileSync(path.join(site, 'notices.txt'), notices({ version: firmware.version, withPage: true, ewt: ewt.version, picolibc: firmware.picolibc }));
  fs.writeFileSync(path.join(release, `${FILE_PREFIX}-${firmware.version}-notices.txt`), notices({ version: firmware.version, withPage: false, picolibc: firmware.picolibc }));
  fs.writeFileSync(path.join(out, 'release-notes.md'), releaseNotes({ firmware, repo, commit, pageUrl }));
  return { site, release, espWebTools: ewt.version };
}

function main() {
  const { values } = parseArgs({
    options: {
      build: { type: 'string' },
      out: { type: 'string', default: path.join(INSTALLER, 'dist') },
      version: { type: 'string' },
      commit: { type: 'string' },
      repo: { type: 'string', default: DEFAULT_REPO },
      'page-url': { type: 'string' },
    },
    strict: true,
  });
  if (!values.build) fail('usage: node scripts/package.mjs --build <firmware build folder> [--out dist] [--version x.y.z] [--commit sha] [--repo url] [--page-url url]');
  const firmware = readFirmware(path.resolve(values.build), { version: values.version });
  const out = path.resolve(values.out);
  const result = writePackage({ firmware, out, repo: values.repo, commit: values.commit, pageUrl: values['page-url'] });
  console.log(`${NAME} ${firmware.version} for ${firmware.chipFamily} (${firmware.project}, ESP-IDF ${firmware.idf}), with ESP Web Tools ${result.espWebTools}:`);
  for (const p of firmware.parts) console.log(`  ${hex(p.offset).padEnd(8)} ${partName(firmware.version, p.role).padEnd(40)} ${p.data.length} bytes`);
  console.log(`page: ${path.relative(process.cwd(), result.site) || '.'}\nrelease files: ${path.relative(process.cwd(), result.release) || '.'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof PackageError) && err?.code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && err?.code !== 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') throw err;
    console.error(`package: ${err.message}`);
    process.exitCode = 1;
  }
}
