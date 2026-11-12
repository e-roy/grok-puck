// Keeps personal details and secrets out of this public repo. Runs locally only, as two git hooks
// (enabled once per clone: git config core.hooksPath .githooks):
//   - .githooks/pre-commit refuses a commit whose staged files hold something below;
//   - .githooks/pre-push refuses a push whose commits do: their messages, names and emails, and what
//     each adds (`--commits`), so a rebase, cherry-pick or amend that skipped pre-commit is caught.
// What it refuses:
//   - anything listed in private/denylist.txt (git-ignored, kept by each maintainer for themselves:
//     their name, email, domain, home network addresses, Wi-Fi names, device IDs...), or
//   - something that looks like a key, token or private key, or a file that should never be committed
//     (.env, logs, the bridge's data, sdkconfig).
// Findings name the file and line (or the commit and field) and the denylist line, never the matched
// text or the entry, so the output itself leaks nothing. That includes an entry that isn't a valid
// regular expression, and a file path that matches the denylist: both are named by line number only.
//
//   node scripts/check-private.mjs                       check the staged changes (the pre-commit hook)
//   node scripts/check-private.mjs --all                 check every file git would track
//   node scripts/check-private.mjs --commits <rev>...    check commits: each one's message, author and
//                                                        committer names and emails, and what it adds
//                                                        (files and lines; merges: message and names)
//
// --commits takes git revisions: a range (main..HEAD), commits, and --not, --remotes[=<remote>] or
// --branches[=<pattern>], e.g. `--commits <sha> --not --remotes=origin`: the commits not yet on origin.
//
// private/denylist.txt: one entry per line, matched case-insensitively. Plain text matches as is;
// `re:` starts a regular expression (e.g. `re:\bjane\b`). `#` starts a comment.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const USAGE = 'usage: node scripts/check-private.mjs [--all | --commits <revision>...]';
// The only options passed on to git after --commits; anything else starting with "-" is refused.
const REVISION_OPTION = /^--(not|remotes(=.+)?|branches(=.+)?)$/;
const args = process.argv.slice(2);
let mode = 'staged';
let revisions = [];
if (args[0] === '--commits') {
  mode = 'commits';
  revisions = args.slice(1);
  const unexpected = revisions.find((r) => r.startsWith('-') && !REVISION_OPTION.test(r));
  if (unexpected) usage(`unexpected argument "${unexpected}"`);
  if (!revisions.some((r) => !r.startsWith('-'))) usage('--commits needs a range or a commit, such as main..HEAD');
} else if (args[0] === '--all') {
  mode = 'all';
  if (args.length > 1) usage(`unexpected argument "${args[1]}"`);
} else if (args.length) usage(`unexpected argument "${args[0]}"`);

function usage(problem) {
  fail(`check-private: ${problem}.\n${USAGE}`);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function git(gitArgs, options = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...gitArgs], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
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

function checkLine(line, where) {
  for (const [re, why] of SECRET_PATTERNS) if (re.test(line)) findings.push(`${where}: looks like ${why}`);
  for (const entry of denylist?.entries ?? []) {
    if (entry.re.test(line)) findings.push(`${where}: matches private/denylist.txt line ${entry.line}`);
  }
}

// Checks each line of `text`; `where(n)` names line n in a finding.
function checkText(text, where) {
  text.split(/\r?\n/).forEach((line, i) => checkLine(line, where(i + 1)));
}

// A file's name in findings. A path that matches the denylist would print the matched text, so it is
// named by the denylist line instead.
function shown(file) {
  const entry = denylist?.entries.find((e) => e.re.test(file));
  return entry ? `(a path matching private/denylist.txt line ${entry.line})` : file;
}

// A path that is added or changed: never one of the forbidden files, never a denylist match.
function checkPath(file, prefix = '') {
  for (const [re, why] of FORBIDDEN_PATHS) if (re.test(file)) findings.push(`${prefix}${shown(file)}: ${why} must not be committed`);
  for (const entry of denylist?.entries ?? []) {
    if (entry.re.test(file)) findings.push(`${prefix}a path matches private/denylist.txt line ${entry.line}`);
  }
}

function checkFiles() {
  const all = mode === 'all';
  const list = all ? ['ls-files', '-z', '--cached', '--others', '--exclude-standard'] : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'];
  const files = git(list, { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of files) {
    checkPath(file);
    // Staged content for a commit (what will actually be committed), the working file for --all.
    const bytes = all
      ? fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file)) : Buffer.alloc(0)
      : git(['show', `:${file}`]);
    // Binary files (images, STL) are checked as Latin-1 text: names in metadata still show up.
    const text = bytes.includes(0) ? bytes.toString('latin1') : bytes.toString('utf8');
    checkText(text, (n) => `${shown(file)}:${n}`);
  }
}

// Each commit: its message and the names and emails it was made with, which never pass through the
// pre-commit hook (and git config can hold a personal email by mistake), and what it adds. Something
// added in one commit and removed in a later one is still published with the commit, and rebases,
// cherry-picks and amends don't always run the pre-commit hook.
function checkCommits() {
  // -z ends each commit with a NUL; the fields are NUL-separated too, and none can contain one.
  let out;
  try {
    out = git(['log', '-z', '--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%B', ...revisions, '--'], { encoding: 'utf8' });
  } catch {
    fail(`check-private: git can't read the commits ${revisions.join(' ')}.`);
  }
  const fields = out ? out.split('\0') : [];
  let count = 0;
  for (let i = 0; i + 7 <= fields.length; i += 7) {
    const [sha, parents, authorName, authorEmail, committerName, committerEmail, message] = fields.slice(i, i + 7);
    const at = `commit ${sha.slice(0, 12)}`;
    checkText(authorName, () => `${at}: author name`);
    checkText(authorEmail, () => `${at}: author email`);
    checkText(committerName, () => `${at}: committer name`);
    checkText(committerEmail, () => `${at}: committer email`);
    checkText(message, (n) => `${at}: message line ${n}`);
    // A merge's own changes only combine commits that are checked on their own.
    if (parents.split(' ').filter(Boolean).length <= 1) checkAdded(sha, at);
    count++;
  }
  return count;
}

// What one commit adds, against its parent (or everything, for a first commit): the paths it adds or
// changes, and its added lines.
function checkAdded(sha, at) {
  const diff = ['diff-tree', '-r', '--root', '--no-commit-id', '--no-renames', '--diff-filter=ACMRT'];
  for (const file of git([...diff, '--name-only', '-z', sha], { encoding: 'utf8' }).split('\0').filter(Boolean)) {
    checkPath(file, `${at}: `);
  }
  // --text shows binary files' lines too, so names in their metadata are found as for staged files.
  const patch = git([...diff, '-p', '-U0', '--text', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', sha]);
  let file = null;
  let line = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const row of patch.toString('utf8').split('\n')) {
    // Inside a hunk, its header's counts say which rows are lines (any row may look like a header).
    if (oldLeft > 0 || newLeft > 0) {
      if (row.startsWith('+')) {
        if (file) checkLine(row.slice(1).replace(/\r$/, ''), `${at}: ${shown(file)}:${line}`);
        line++;
        newLeft--;
      } else if (row.startsWith('-')) oldLeft--;
      else if (row.startsWith(' ')) {
        line++;
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    if (row.startsWith('diff --git ')) file = null;
    else if (row.startsWith('+++ ')) {
      const name = row.slice(4).replace(/^"(.*)"$/, '$1');
      file = name.startsWith('b/') ? name.slice(2) : null;
    } else if (row.startsWith('@@ ')) {
      const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row);
      if (hunk) {
        oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
        line = Number(hunk[2]);
        newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
    }
  }
}

// For messages: revisions with full SHAs shortened.
const revisionText = revisions.join(' ').replace(/\b([0-9a-f]{12})[0-9a-f]{28,52}\b/g, '$1');

let checked;
if (mode === 'commits') {
  const count = checkCommits();
  checked = `${count} commit${count === 1 ? '' : 's'} (${revisionText})`;
} else {
  checkFiles();
  checked = mode === 'all' ? 'all tracked files' : 'staged changes';
}

if (!denylist) {
  console.warn('check-private: no private/denylist.txt, so only secrets and forbidden files were checked.');
  console.warn('  Create it with the personal details that must never be published (see scripts/check-private.mjs).');
}
if (findings.length) {
  console.error(`check-private: refused. ${findings.length} problem${findings.length > 1 ? 's' : ''}:`);
  for (const f of findings) console.error(`  ${f}`);
  if (denylist?.invalid.length) console.error('Fix those private/denylist.txt lines: after `re:` comes a JavaScript regular expression.');
  if (findings.length > (denylist?.invalid.length ?? 0)) {
    if (mode === 'commits') {
      console.error('Rewrite those commits (git rebase -i can edit or drop them; fix git config user.name and');
      console.error('user.email first if they are the problem), then push again.');
    } else {
      console.error('Remove them (or replace with placeholders like desk.example.com), then commit again.');
    }
  }
  process.exit(1);
}
console.log(`check-private: ${checked} clean.`);
