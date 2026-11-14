// The Listen page (spec §5.10): plays a desk device's speech in this browser tab, with the bot's avatar
// showing what the device shows, Start listening (browsers play sound only after a click), Stop, and a
// picker when there are several devices.
import { BotIcon, HeadphonesIcon, SquareIcon, TriangleAlertIcon, Volume2Icon, WifiOffIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Avatar, type AvatarState } from '@/components/app/Avatar.tsx';
import { ThemeSwitch } from '@/components/app/ThemeSwitch.tsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ListenLink, type ListenState, type PageDevice } from './link.ts';

const GREY = { shape: 'blob', color: '#9ca3af' } as const;

const STATE_TEXT: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  working: 'Working…',
  waiting: 'Waiting for you',
  speaking: 'Speaking',
  error: 'Something went wrong',
};

export function ListenPage() {
  const link = useMemo(() => new ListenLink(), []);
  useEffect(() => {
    link.connect();
    return () => link.close();
  }, [link]);
  const state = useSyncExternalStore(link.subscribe, link.snapshot);
  const device = state.devices?.find((d) => d.id === state.device);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <BotIcon className="size-4" />
          </span>
          Grok Puck
          <span className="font-normal text-muted-foreground">· Listen</span>
        </a>
        <ThemeSwitch />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-8 pb-12">
        <Connection state={state} onRetry={() => link.retry()} />
        {state.devices === undefined ? (
          <div className="flex flex-col items-center gap-4" aria-label="Loading">
            <Skeleton className="size-48 rounded-full" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-48" />
          </div>
        ) : state.devices.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HeadphonesIcon />
              </EmptyMedia>
              <EmptyTitle>No desk device yet</EmptyTitle>
              <EmptyDescription>
                Approve a device in the <a href="/#devices">admin page</a> first; its speech can then play here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {state.devices.length > 1 && <Picker devices={state.devices} value={state.device} onChange={(id) => link.choose(id)} />}
            {device && <Player state={state} device={device} link={link} />}
          </>
        )}
      </main>
    </div>
  );
}

function Connection({ state, onRetry }: { state: ListenState; onRetry: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.connection !== 'closed') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.connection]);
  if (state.connection === 'signed-out') {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Signed out</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          Your sign-in to this page has ended, so speech no longer plays here; the device speaks instead.
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload to sign in again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (state.connection !== 'closed') return null;
  const seconds = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  return (
    <Alert variant="destructive">
      <WifiOffIcon />
      <AlertTitle>Can&apos;t reach the bridge</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        {seconds > 0 ? `Trying again in ${seconds} s.` : 'Trying again…'} Until then, the device speaks instead of this page.
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try now
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function Picker({ devices, value, onChange }: { devices: PageDevice[]; value: string | null; onChange: (id: string) => void }) {
  const items = devices.map((d) => ({ value: d.id, label: d.bot ? `${d.name} (${d.bot.name})` : d.name }));
  return (
    <Field>
      <FieldLabel htmlFor="listen-device">Play the speech of</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => v && onChange(String(v))}>
        <SelectTrigger id="listen-device" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Player({ state, device, link }: { state: ListenState; device: PageDevice; link: ListenLink }) {
  const connected = state.connection === 'open';
  const speaking = state.playing || state.shown === 'speaking';
  const avatar: AvatarState = !connected ? 'offline' : speaking ? 'speaking' : ((STATE_TEXT[state.shown] ? state.shown : 'idle') as AvatarState);
  const playsHere = state.started && !state.paused && state.role === 'here';
  const label = !connected ? 'Not connected' : state.playing ? 'Speaking here' : (STATE_TEXT[state.shown] ?? 'Idle');
  const [starting, setStarting] = useState(false);
  const start = () => {
    setStarting(true);
    void link.startListening().finally(() => setStarting(false));
  };

  return (
    <section aria-labelledby="listen-title" className="flex flex-col items-center gap-5 text-center">
      <Avatar avatar={device.bot?.avatar ?? GREY} size={192} state={avatar} />
      <div>
        <h1 id="listen-title" className="text-xl font-semibold tracking-tight">
          {device.bot?.name ?? device.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {device.bot ? `on ${device.name}` : 'no bot yet'}
          {!device.online && ' · the device is offline'}
        </p>
        <p className="mt-2 text-sm font-medium" aria-live="polite">
          {label}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {(!state.started || state.paused) && (
          <Button size="lg" className="h-11 px-5" onClick={start} disabled={!connected || starting}>
            {starting ? <Spinner /> : <HeadphonesIcon />}
            {state.paused ? 'Start listening again' : 'Start listening'}
          </Button>
        )}
        {state.started && !state.paused && state.role === 'elsewhere' && (
          <Button size="lg" className="h-11 px-5" onClick={start} disabled={!connected || starting}>
            <Volume2Icon /> Play here
          </Button>
        )}
        <Button size="lg" variant="outline" className="h-11 px-5" onClick={() => link.stopSpeech()} disabled={!connected || !speaking}>
          <SquareIcon /> Stop
        </Button>
      </div>

      <p className="max-w-sm text-sm text-muted-foreground">{explain(state, device, playsHere)}</p>
      {state.problem && (
        <Alert variant="destructive" className="text-left">
          <TriangleAlertIcon />
          <AlertDescription>{state.problem}</AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        Speak on, volume and mute: <a href="/#devices" className="font-medium text-foreground underline underline-offset-4">admin page</a>
      </p>
    </section>
  );
}

/** One or two sentences: where this device's speech plays now, and why. */
function explain(state: ListenState, device: PageDevice, playsHere: boolean): ReactNode {
  const name = device.name;
  if (state.connection !== 'open') return ''; // the alert above says what is going on
  if (device.muted) return `${name} is muted: nothing plays, here or on the device.`;
  if (!state.started) {
    if (device.speak_on === 'device') {
      return `${name}'s Speak on is set to the device, so its speech plays there. To hear it here, set Speak on to the Listen page or both in the admin page.`;
    }
    return device.page_ready
      ? `Another Listen page plays ${name}'s speech now. Press Start listening to play it here instead.`
      : `Press Start listening to hear ${name} here (browsers play sound only after a click). Until then, the device speaks.`;
  }
  if (state.paused) return `Your browser paused this page's sound, so the device speaks for now.`;
  if (state.role === 'elsewhere') return `Playing elsewhere: a Listen page started after this one plays ${name}'s speech.`;
  if (!playsHere) return '';
  if (device.speak_on === 'device') {
    return `Ready, but ${name}'s Speak on is set to the device, so its speech plays there. Set it to the Listen page or both in the admin page.`;
  }
  if (device.speak_on === 'both') {
    return device.online ? `${name}'s speech plays here and on the device.` : `${name}'s speech plays here; the device is offline.`;
  }
  return device.online ? `${name}'s speech plays here. Keep this tab open: it plays in the background too.` : `${name}'s speech plays here, even while the device is offline.`;
}
