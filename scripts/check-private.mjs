// Keeps personal details and secrets out of this public repo. Runs as the pre-commit hook
// (.githooks/pre-commit) and refuses a commit when a staged file contains:
//   - anything listed in private/denylist.txt (git-ignored, kept by each maintainer for themselves:
//     their name, email, domain, home network addresses, Wi-Fi names, device IDs...), or
//   - something that looks like a key, token or private key, or a file that should never be committed
//     (.env, logs, the bridge's data, sdkconfig).
// Findings name the file, line and denylist line, never the matched text, so the output itself
// leaks nothing.
//
//   node scripts/check-private.mjs            check the staged changes (what the hook runs)
//   node scripts/check-private.mjs --all      check every file git would track
//
// private/denylist.txt: one entry per line, matched case-insensitively. Plain text matches as is;
// `re:` starts a regular expression (e.g. `re:\bjane\b`). `#` starts a comment.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const all = process.argv.includes('--all');

// Files that must never be committed, whatever they contain.
const FORBIDDEN_PATHS = [
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, 'an environment file (.env holds keys and tokens)'],
  [/\.log$/, 'a log (local paths, ports, MAC addresses)'],
  [/(^|\/)sdkconfig(\.old)?$/, 'a generated sdkconfig (can hold Wi-Fi credentials)'],
  [/^bridge\/data\//, "the bridge's data (keys, devices, history)"],
  [/(^|\/)state\.json$/, "a bridge state file (keys, devices, history)"],
  [/^private\//, 'private notes'],
  [/(^|\/)CLAUDE\.local\.md$/, 'personal instructions'],
  [/\.(pem|key|p12|pfx)$/, 'a key or certificate file'],
];

// Text that looks like a secret. Kept specific, so ordinary code doesn't trip it.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/, 'a GitHub token'],
  [/\b(sk|xai)-[A-Za-z0-9_-]{24,}/, 'an API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS key'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'a signed token (JWT)'],
  [/\beyJhIjoi[A-Za-z0-9+/=_-]{40,}/, 'a Cloudflare tunnel token'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{32,}/, 'a bearer token'],
];

function readDenylist() {
  const file = path.join(root, 'private', 'denylist.txt');
  if (!fs.existsSync(file)) return null;
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter((e) => e.raw && !e.raw.startsWith('#'))
    .map((e) => {
      const source = e.raw.startsWith('re:') ? e.raw.slice(3) : e.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { line: e.line, re: new RegExp(source, 'i') };
    });
}

function filesToCheck() {
  const args = all ? ['ls-files', '-z', '--cached', '--others', '--exclude-standard'] : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function contentOf(file) {
  // Staged content for a commit (what will actually be committed), the working file for --all.
  if (all) return fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : Buffer.alloc(0);
  return execFileSync('git', ['show', `:${file}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
}

const denylist = readDenylist();
const findings = [];
for (const file of filesToCheck()) {
  for (const [re, why] of FORBIDDEN_PATHS) if (re.test(file)) findings.push(`${file}: ${why} must not be committed`);
  const bytes = contentOf(file);
  // Binary files (images, STL) are checked as Latin-1 text: names in metadata still show up.
  const text = bytes.includes(0) ? bytes.toString('latin1') : bytes.toString('utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [re, why] of SECRET_PATTERNS) if (re.test(line)) findings.push(`${file}:${i + 1}: looks like ${why}`);
    for (const entry of denylist ?? []) if (entry.re.test(line)) findings.push(`${file}:${i + 1}: matches private/denylist.txt line ${entry.line}`);
  });
}

if (!denylist) {
  console.warn('check-private: no private/denylist.txt, so only secrets and forbidden files were checked.');
  console.warn('  Create it with the personal details that must never be published (see scripts/check-private.mjs).');
}
if (findings.length) {
  console.error(`check-private: refused. ${findings.length} problem${findings.length > 1 ? 's' : ''}:`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('Remove them (or replace with placeholders like desk.example.com), then commit again.');
  process.exit(1);
}
console.log(`check-private: ${all ? 'all tracked files' : 'staged changes'} clean.`);
