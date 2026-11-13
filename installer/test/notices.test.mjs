// The licence notices name what the published files contain: these fail when a dependency changes
// and the notices weren't looked at again. The firmware's: ESP-IDF and every component in
// firmware/dependencies.lock, with its version. The page's: every package in installer/pnpm-lock.yaml.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lineWith = (text, ...words) => text.split('\n').some((line) => words.every((w) => line.includes(w)));

/** firmware/dependencies.lock: { name: version } for each component, and ESP-IDF as "idf". */
function firmwareComponents() {
  const lock = read('../../firmware/dependencies.lock');
  const section = lock.split(/^direct_dependencies:/m)[0];
  const found = {};
  let name = null;
  for (const line of section.split('\n')) {
    const top = /^ {2}(\S+):\s*$/.exec(line);
    if (top) name = top[1];
    const version = /^ {4}version: '?([^'\s]+)'?\s*$/.exec(line);
    if (version && name) {
      found[name] = version[1];
      name = null;
    }
  }
  return found;
}

/** installer/pnpm-lock.yaml: { name: version } for the project's packages (not pnpm's own). */
function pagePackages() {
  const documents = read('../pnpm-lock.yaml').split(/^---$/m).filter((d) => d.trim());
  // pnpm 11 writes pnpm itself (packageManagerDependencies) in a document of its own, first.
  const project = documents.find((d) => /^importers:\n\n {2}\.:\n {4}dependencies:/m.test(d));
  assert.ok(project, 'pnpm-lock.yaml has the project with its dependencies');
  const packages = project.split(/^packages:$/m)[1].split(/^snapshots:$/m)[0];
  const found = {};
  for (const [, name, version] of packages.matchAll(/^ {2}'?((?:@[^@\s'/]+\/)?[^@\s']+)@([^:'(\s]+)'?:\s*$/gm)) found[name] = version;
  return found;
}

test('the firmware notices name ESP-IDF and each component in dependencies.lock, with its version', () => {
  const notices = read('../../firmware/NOTICES.md');
  const components = firmwareComponents();
  assert.ok(components.idf, 'dependencies.lock names the ESP-IDF version');
  assert.ok(Object.keys(components).length >= 8, 'dependencies.lock was read');
  assert.ok(notices.includes(`ESP-IDF ${components.idf}`), `firmware/NOTICES.md doesn't name ESP-IDF ${components.idf}`);
  for (const [name, version] of Object.entries(components)) {
    if (name === 'idf') continue;
    assert.ok(lineWith(notices, `\`${name}\``, `| ${version} |`), `firmware/NOTICES.md has no row for ${name} ${version}`);
  }
});

test('the page notices name each package in pnpm-lock.yaml, with its version', () => {
  const notices = read('../NOTICES.md');
  const packages = pagePackages();
  assert.ok(packages['esp-web-tools'], 'pnpm-lock.yaml has esp-web-tools');
  for (const [name, version] of Object.entries(packages)) {
    assert.ok(lineWith(notices, `| ${name} | ${version} |`), `installer/NOTICES.md has no row for ${name} ${version}`);
  }
});

test('every licence text the notices point to is there', () => {
  for (const [file, notices] of [['../../firmware/', read('../../firmware/NOTICES.md')], ['../', read('../NOTICES.md')]]) {
    for (const [, target] of notices.matchAll(/\]\(((?:\.\.\/)?(?:firmware\/)?licenses\/[^)]+)\)/g)) {
      assert.ok(fs.existsSync(new URL(file + target, import.meta.url)), `${target} is missing`);
    }
  }
});
