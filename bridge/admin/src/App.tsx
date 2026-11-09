// The admin page: five sections (a sidebar on a computer, a bar at the bottom on a phone), the section
// kept in the address. Every section stays mounted, so edits survive switching between them.
import { AudioLinesIcon, BotIcon, HistoryIcon, type LucideIcon, MonitorIcon, MoonIcon, PlugIcon, SunIcon, TabletSmartphoneIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Overview } from '@/api.ts';
import { ErrorBoundary } from '@/components/app/ErrorBoundary.tsx';
import type { Voices } from '@/components/app/Section.tsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { makeRun } from '@/lib/run.ts';
import { type ThemeChoice, useTheme } from '@/lib/theme.tsx';
import { cn } from '@/lib/utils';
import { Bots } from '@/sections/Bots.tsx';
import { Devices } from '@/sections/Devices.tsx';
import { GrokBot } from '@/sections/GrokBot.tsx';
import { History } from '@/sections/History.tsx';
import { Speech } from '@/sections/Speech.tsx';

const REFRESH_MS = 2000;

const SECTIONS = [
  { id: 'devices', label: 'Devices', icon: TabletSmartphoneIcon, Component: Devices },
  { id: 'bots', label: 'Bots', icon: BotIcon, Component: Bots },
  { id: 'speech', label: 'Speech', icon: AudioLinesIcon, Component: Speech },
  { id: 'grok-bot', label: 'Grok Bot', icon: PlugIcon, Component: GrokBot },
  { id: 'history', label: 'History', icon: HistoryIcon, Component: History },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

function sectionFromHash(): SectionId {
  const id = window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : 'devices';
}

function useSection(): SectionId {
  const [section, setSection] = useState(sectionFromHash);
  useEffect(() => {
    const onHash = () => {
      setSection(sectionFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return section;
}

function useWide(): boolean {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const listener = () => setWide(list.matches);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }, []);
  return wide;
}

export function App() {
  const [data, setData] = useState<Overview>();
  const [offline, setOffline] = useState('');
  const section = useSection();
  const wide = useWide();

  const refresh = useCallback(async () => {
    try {
      setData(await api<Overview>('GET', '/api/overview'));
      setOffline('');
    } catch (err) {
      setOffline(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = useMemo(() => makeRun(refresh), [refresh]);

  // The TTS service's voices, for the bots' voice pickers and the setup checklist.
  const [voices, setVoices] = useState<Voices>({ list: [], error: '', loaded: false });
  const tts = data?.speech.tts;
  useEffect(() => {
    if (!tts) return;
    let current = true;
    api<{ voices: string[]; error?: string }>('GET', '/api/voices')
      .catch((err: Error) => ({ voices: [] as string[], error: err.message }))
      .then((r) => current && setVoices({ list: r.voices, error: r.error ?? '', loaded: true }));
    return () => {
      current = false;
    };
  }, [tts?.provider, tts?.baseUrl, tts?.model, tts?.apiKeySet]);

  const waiting = data?.devices.filter((d) => d.status === 'pending').length ?? 0;

  return (
    <div className="min-h-svh md:flex">
      <Sidebar section={section} waiting={waiting} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
          <Brand />
          <ThemeSwitch />
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-16">
          {offline && (
            <Alert variant="destructive" className="mb-6">
              <TriangleAlertIcon />
              <AlertTitle>Can't reach the bridge</AlertTitle>
              <AlertDescription>{offline}. The page keeps trying every few seconds.</AlertDescription>
            </Alert>
          )}
          {data ? (
            SECTIONS.map(({ id, label, Component }) => (
              <div key={id} hidden={id !== section}>
                <ErrorBoundary where={`the ${label} section`}>
                  <Component data={data} run={run} voices={voices} />
                </ErrorBoundary>
              </div>
            ))
          ) : (
            <div className="space-y-4" aria-label="Loading">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}
        </main>
      </div>
      <BottomBar section={section} waiting={waiting} />
      <Toaster position={wide ? 'bottom-right' : 'top-center'} />
    </div>
  );
}

function Brand() {
  return (
    <a href="#devices" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <BotIcon className="size-4" />
      </span>
      Desk Bridge
    </a>
  );
}

function NavCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto rounded-full bg-warning px-1.5 text-xs font-medium text-black" aria-label={`${count} waiting for approval`}>
      {count}
    </span>
  );
}

function Sidebar({ section, waiting }: { section: SectionId; waiting: number }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar p-3 text-sidebar-foreground md:flex">
      <div className="px-2 py-2">
        <Brand />
      </div>
      <nav aria-label="Sections" className="mt-4 flex flex-col gap-0.5">
        {SECTIONS.map(({ id, label, icon }) => (
          <NavLink key={id} id={id} label={label} icon={icon} active={id === section} count={id === 'devices' ? waiting : 0} />
        ))}
      </nav>
      <div className="mt-auto flex items-center justify-between px-2 text-xs text-muted-foreground">
        <span>Admin page</span>
        <ThemeSwitch />
      </div>
    </aside>
  );
}

function NavLink({ id, label, icon: Icon, active, count }: { id: string; label: string; icon: LucideIcon; active: boolean; count: number }) {
  return (
    <a
      href={`#${id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
      <NavCount count={count} />
    </a>
  );
}

function BottomBar({ section, waiting }: { section: SectionId; waiting: number }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={id === section ? 'page' : undefined}
          className={cn(
            'relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium outline-none focus-visible:bg-muted',
            id === section ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-5" />
          {label}
          {id === 'devices' && waiting > 0 && (
            <span className="absolute top-1.5 right-[calc(50%-18px)] size-2 rounded-full bg-warning" aria-label={`${waiting} waiting for approval`} />
          )}
        </a>
      ))}
    </nav>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Same as the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemeSwitch() {
  const { choice, resolved, choose } = useTheme();
  const Icon = choice === 'system' ? MonitorIcon : resolved === 'dark' ? MoonIcon : SunIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Theme" />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {/* Base UI wants a menu's label inside its group: outside one it throws when the menu opens. */}
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => choose(v as ThemeChoice)}>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value} closeOnClick>
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
