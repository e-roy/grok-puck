// Keeps personal details and secrets out of this public repo. Runs as the pre-commit hook
// (.githooks/pre-commit) and on every pull request (.github/workflows/ci.yml), and refuses when it
// finds:
//   - anything listed in private/denylist.txt (git-ignored, kept by each maintainer for themselves:
//     their name, email, domain, home network addresses, Wi-Fi names, device IDs...), or
//   - something that looks like a key, token or private key, or a file that should never be committed
//     (.env, logs, the bridge's data, sdkconfig).
// Findings name the file and line (or the commit and field) and the denylist line, never the matched
// text or the entry, so the output itself leaks nothing. That includes an entry that isn't a valid
// regular expression: it is named by its line number only.
//
//   node scripts/check-private.mjs                    check the staged changes (what the hook runs)
//   node scripts/check-private.mjs --all              check every file git would track
//   node scripts/check-private.mjs --commits <range>  check each commit's message and its author and
//                                                     committer names and emails (e.g. main..HEAD),
//                                                     which the hook never sees
//
// private/denylist.txt: one entry per line, matched case-insensitively. Plain text matches as is;
// `re:` starts a regular expression (e.g. `re:\bjane\b`). `#` starts a comment.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = 'usage: node scripts/check-private.mjs [--all | --commits <range>]';
const args = process.argv.slice(2);
let mode = 'staged';
let range = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--all' && mode === 'staged') mode = 'all';
  else if (args[i] === '--commits' && mode === 'staged') {
    mode = 'commits';
    range = args[++i];
    // A range starting with "-" would be read by git as an option.
    if (!range || range.startsWith('-')) fail(`check-private: --commits needs a range, such as main..HEAD.\n${USAGE}`);
  } else fail(`check-private: unexpected argument "${args[i]}".\n${USAGE}`);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

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
  const entries = [];
  const invalid = [];
  fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '') // a byte-order mark (some Windows editors); trim() drops it too
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const text = raw.trim();
      if (!text || text.startsWith('#')) return;
      const source = text.startsWith('re:') ? text.slice(3) : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        entries.push({ line: i + 1, re: new RegExp(source, 'i') });
      } catch {
        // The error's message quotes the expression, so it is never shown: only the line number.
        invalid.push(i + 1);
      }
    });
  return { entries, invalid };
}

const denylist = readDenylist();
const findings = [];
for (const line of denylist?.invalid ?? []) {
  findings.push(`private/denylist.txt line ${line}: not a valid regular expression, so it checks nothing`);
}

// Checks each line of `text`; `where(n)` names line n in a finding.
function checkText(text, where) {
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [re, why] of SECRET_PATTERNS) if (re.test(line)) findings.push(`${where(i + 1)}: looks like ${why}`);
    for (const entry of denylist?.entries ?? []) {
      if (entry.re.test(line)) findings.push(`${where(i + 1)}: matches private/denylist.txt line ${entry.line}`);
    }
  });
}

function checkFiles() {
  const all = mode === 'all';
  const list = all ? ['ls-files', '-z', '--cached', '--others', '--exclude-standard'] : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'];
  const files = execFileSync('git', list, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    for (const [re, why] of FORBIDDEN_PATHS) if (re.test(file)) findings.push(`${file}: ${why} must not be committed`);
    // Staged content for a commit (what will actually be committed), the working file for --all.
    const bytes = all
      ? fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : Buffer.alloc(0)
      : execFileSync('git', ['show', `:${file}`], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
    // Binary files (images, STL) are checked as Latin-1 text: names in metadata still show up.
    const text = bytes.includes(0) ? bytes.toString('latin1') : bytes.toString('utf8');
    checkText(text, (n) => `${file}:${n}`);
  }
}

// Each commit in the range: its message, and the names and emails it was made with. These never pass
// through the pre-commit hook, and git config can hold a personal email by mistake.
function checkCommits() {
  // -z ends each commit with a NUL; the fields are NUL-separated too, and none can contain one.
  let out;
  try {
    out = execFileSync('git', ['log', '-z', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B', range, '--'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fail(`check-private: git can't read the range ${range} (in CI, fetch the full history: fetch-depth: 0).`);
  }
  const fields = out ? out.split('\0') : [];
  let count = 0;
  for (let i = 0; i + 6 <= fields.length; i += 6) {
    const [sha, authorName, authorEmail, committerName, committerEmail, message] = fields.slice(i, i + 6);
    const at = `commit ${sha.slice(0, 12)}`;
    checkText(authorName, () => `${at}: author name`);
    checkText(authorEmail, () => `${at}: author email`);
    checkText(committerName, () => `${at}: committer name`);
    checkText(committerEmail, () => `${at}: committer email`);
    checkText(message, (n) => `${at}: message line ${n}`);
    count++;
  }
  return count;
}

let checked;
if (mode === 'commits') {
  const count = checkCommits();
  checked = `${count} commit${count === 1 ? '' : 's'} in ${range}`;
} else {
  checkFiles();
  checked = mode === 'all' ? 'all tracked files' : 'staged changes';
}

if (!denylist) {
  console.warn(`check-private: no private/denylist.txt, so only secrets${mode === 'commits' ? '' : ' and forbidden files'} were checked.`);
  console.warn('  Create it with the personal details that must never be published (see scripts/check-private.mjs).');
}
if (findings.length) {
  console.error(`check-private: refused. ${findings.length} problem${findings.length > 1 ? 's' : ''}:`);
  for (const f of findings) console.error(`  ${f}`);
  if (denylist?.invalid.length) console.error('Fix those private/denylist.txt lines: after `re:` comes a JavaScript regular expression.');
  if (findings.length > (denylist?.invalid.length ?? 0)) {
    if (mode === 'commits') {
      console.error('Rewrite those commits (fix git config user.name and user.email first if they are the problem), then push again.');
    } else {
      console.error('Remove them (or replace with placeholders like desk.example.com), then commit again.');
    }
  }
  process.exit(1);
}
console.log(`check-private: ${checked} clean.`);
