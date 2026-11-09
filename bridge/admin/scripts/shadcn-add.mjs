// Adds shadcn/ui components (style base-nova) to the admin page without letting the shadcn CLI install
// anything: `shadcn add` would add packages itself (the `shadcn` package with its build tools, and `cn`),
// outside this project's pnpm rules. This fetches the components with `shadcn view`, follows their
// registry dependencies, writes them to src/components/ui/ with imports pointed at our own files
// (`cn` from src/lib/utils.ts) and icon placeholders turned into lucide-react icons, then lists the npm
// packages they need, to add with `pnpm add -D <name>@^<major>`.
//
//   node scripts/shadcn-add.mjs tabs accordion        (in bridge/admin; -o overwrites existing files)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SHADCN = ['--config.minimum-release-age=10080', 'dlx', 'shadcn@4.23.0'];
const OTHER_ICON_LIBRARIES = ['tabler', 'hugeicons', 'phosphor', 'remixicon'];
const adminDir = path.resolve(import.meta.dirname, '..');
const overwrite = process.argv.includes('-o');
const wanted = process.argv.slice(2).filter((a) => a !== '-o');
if (!wanted.length) {
  console.error('Name the components to add, e.g. node scripts/shadcn-add.mjs tabs');
  process.exit(1);
}

function view(names) {
  const out = execFileSync(`pnpm ${[...SHADCN, 'view', ...names.map((n) => `@shadcn/${n}`)].join(' ')}`, {
    cwd: adminDir,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.slice(out.indexOf('[')));
}

function lucideIcons(source, file) {
  if (!source.includes('IconPlaceholder')) return source;
  const icons = new Set();
  let s = source.replace(/<IconPlaceholder\b([\s\S]*?)\/>/g, (_whole, attrs) => {
    const name = attrs.match(/\blucide="([A-Za-z0-9]+)"/)?.[1];
    if (!name) throw new Error(`${file}: an icon without a lucide name`);
    icons.add(name);
    let rest = attrs.replace(/\blucide="[^"]*"/, '');
    for (const lib of OTHER_ICON_LIBRARIES) rest = rest.replace(new RegExp(`\\b${lib}="[^"]*"`), '');
    rest = rest.replace(/\s+/g, ' ').trim();
    return `<${name}${rest ? ` ${rest}` : ''} />`;
  });
  s = s.replace(/import \{ IconPlaceholder \} from "[^"]*"\n/, `import { ${[...icons].sort().join(', ')} } from "lucide-react"\n`);
  if (s.includes('IconPlaceholder')) throw new Error(`${file}: icon placeholders left`);
  return s;
}

const rewrite = (s, file) =>
  lucideIcons(
    s
      .replace(/from "cn"/g, 'from "@/lib/utils"')
      .replace(/@\/registry\/[^/]+\/ui\//g, '@/components/ui/')
      .replace(/@\/registry\/[^/]+\/hooks\//g, '@/hooks/')
      .replace(/@\/registry\/[^/]+\/lib\//g, '@/lib/'),
    file,
  );

const items = new Map();
let queue = [...wanted];
while (queue.length) {
  const batch = [...new Set(queue.filter((n) => !items.has(n)))];
  queue = [];
  if (!batch.length) break;
  for (const item of view(batch)) {
    items.set(item.name, item);
    for (const dep of item.registryDependencies ?? []) {
      const name = dep.replace(/^@shadcn\//, '').replace(/^https:\/\/ui\.shadcn\.com\/r\/styles\/[^/]+\//, '').replace(/\.json$/, '');
      if (name !== 'utils' && !items.has(name)) queue.push(name);
    }
  }
}

const packages = new Set();
for (const item of items.values()) {
  for (const d of item.dependencies ?? []) packages.add(d);
  for (const f of item.files ?? []) {
    const rel = f.path.replace(/^registry\/[^/]+\//, '');
    const target = path.join(adminDir, 'src', rel.startsWith('ui/') ? path.join('components', rel) : rel);
    const shown = path.relative(adminDir, target);
    if (fs.existsSync(target) && !overwrite) {
      console.log(`kept    ${shown} (exists; -o overwrites)`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rewrite(f.content, shown));
    console.log(`wrote   ${shown}`);
  }
}
packages.delete('cn'); // src/lib/utils.ts provides cn, on clsx + tailwind-merge
packages.delete('next-themes'); // src/lib/theme.tsx: point the component at useTheme from "@/lib/theme"
const installed = JSON.parse(fs.readFileSync(path.join(adminDir, 'package.json'), 'utf8')).devDependencies ?? {};
const missing = [...packages].filter((p) => !installed[p]).sort();
console.log(missing.length ? `\nPackages to add with pnpm: ${missing.join(' ')}` : '\nAll the packages they use are installed.');
