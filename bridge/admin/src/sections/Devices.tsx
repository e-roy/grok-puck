// Devices: a highlighted card for each device waiting for approval, and a card per approved device
// with its look and state, its settings, "Try it", its Wi-Fi, and (set apart) Forget all networks and
// Forget.
import { EllipsisVerticalIcon, SendIcon, TabletSmartphoneIcon } from 'lucide-react';
import { useState } from 'react';
import { api, type Bot, type Device } from '@/api.ts';
import { Avatar, avatarState } from '@/components/app/Avatar.tsx';
import { ConfirmButton } from '@/components/app/Confirm.tsx';
import { SectionHeader, type SectionProps, StatusDot } from '@/components/app/Section.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ago, enc } from '@/lib/format.ts';
import { pushList, readList } from '@/lib/local.ts';
import { type Run, showError } from '@/lib/run.ts';
import { Checklist } from './Checklist.tsx';
import { DeviceWifi } from './DeviceWifi.tsx';

const GREY = { shape: 'blob', color: '#9ca3af' } as const;

export function Devices({ data, run, voices }: SectionProps) {
  const pending = data.devices.filter((d) => d.status === 'pending');
  const approved = data.devices.filter((d) => d.status === 'approved');
  return (
    <>
      <SectionHeader title="Devices">
        A new device appears here when it first connects. Approve it while it is online: it receives its key at that moment.
      </SectionHeader>
      <Checklist data={data} voices={voices} />
      <div className="flex flex-col gap-4">
        {pending.map((d) => (
          <PendingDevice key={d.id} device={d} bots={data.bots} run={run} />
        ))}
        {approved.map((d) => (
          <DeviceCard key={d.id} device={d} bots={data.bots} states={data.displayStates} run={run} />
        ))}
        {data.devices.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TabletSmartphoneIcon />
              </EmptyMedia>
              <EmptyTitle>No device yet</EmptyTitle>
              <EmptyDescription>
                Set a desk display up from its Wi-Fi setup screen (or run <code>pnpm fake-device</code>) and it appears here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </>
  );
}

function botItems(bots: Bot[]) {
  return [{ value: '', label: 'No bot' }, ...bots.map((b) => ({ value: b.id, label: b.name }))];
}

function BotSelect({ id, value, bots, onChange }: { id: string; value: string; bots: Bot[]; onChange: (botId: string) => void }) {
  const items = botItems(bots);
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ''))}>
      <SelectTrigger id={id} className="w-full">
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
  );
}

function PendingDevice({ device, bots, run }: { device: Device; bots: Bot[]; run: Run }) {
  const url = `/api/devices/${enc(device.id)}`;
  const [name, setName] = useState(device.name);
  const [botId, setBotId] = useState(device.botId || bots[0]?.id || '');
  return (
    <Card className="border-warning/60 bg-warning/5 ring-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StatusDot on={device.waiting} label={device.waiting ? 'online' : 'offline'} />
          New device waiting for approval
        </CardTitle>
        <CardDescription>
          <span className="font-mono">{device.id}</span> · firmware {device.firmware || 'unknown'} · first seen {ago(device.firstSeen)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${device.id}-new-name`}>Name</FieldLabel>
            <Input id={`${device.id}-new-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${device.id}-new-bot`}>Bot</FieldLabel>
            <BotSelect id={`${device.id}-new-bot`} value={botId} bots={bots} onChange={setBotId} />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          disabled={!device.waiting}
          onClick={() => void run(() => api('POST', `${url}/approve`, { botId: botId || undefined, name }), `${name} approved.`)}
        >
          Approve
        </Button>
        <ConfirmButton
          danger
          title={`Forget ${device.name}?`}
          description="It disappears from this list. If it connects again, it asks for approval again."
          confirm="Forget"
          onConfirm={() => void run(() => api('DELETE', url), 'Forgotten.')}
        >
          Forget
        </ConfirmButton>
        {!device.waiting && <span className="text-sm text-muted-foreground">It must be online to be approved.</span>}
      </CardFooter>
    </Card>
  );
}

function DeviceCard({ device, bots, states, run }: { device: Device; bots: Bot[]; states: string[]; run: Run }) {
  const url = `/api/devices/${enc(device.id)}`;
  const bot = bots.find((b) => b.id === device.botId);
  const [name, setName] = useState(device.name);
  const [volume, setVolume] = useState(device.volume);
  const [longest, setLongest] = useState(String(device.timings.maxListenMs / 1000));
  const patch = (body: object, success = 'Saved.') => run(() => api('PATCH', url, body), success);
  const online = device.online;
  const id = (part: string) => `${device.id}-${part}`;

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== device.name) void patch({ name: trimmed }, 'Name saved.');
    else setName(device.name);
  };
  const saveLongest = () => {
    const s = Math.round(Number(longest));
    if (!Number.isFinite(s) || s < 5 || s > 120) {
      if (longest !== '') showError(`The longest message is 5 to 120 seconds, so ${longest} was not saved.`);
      setLongest(String(device.timings.maxListenMs / 1000));
      return;
    }
    if (s * 1000 !== device.timings.maxListenMs) void patch({ timings: { maxListenMs: s * 1000 } }, 'Longest message saved.');
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-4">
        <Avatar avatar={bot?.avatar ?? GREY} size={64} state={avatarState(device.showing, online)} />
        <div className="min-w-0 flex-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="truncate">{device.name}</span>
            {device.muted && <Badge variant="secondary">muted</Badge>}
          </CardTitle>
          <CardDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusDot on={online} label={online ? 'online' : 'offline'} />
            {online ? `Online, showing ${device.showing ?? 'idle'}` : `Offline, last seen ${ago(device.lastSeen)}`}
            <span aria-hidden>·</span>
            <span>{bot ? bot.name : 'no bot'}</span>
          </CardDescription>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{device.id}</span> · {device.firmware || 'firmware unknown'}
          </p>
        </div>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Test ${device.name}`} disabled={!online} />}>
              <EllipsisVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show a state (test)</DropdownMenuLabel>
                {states.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => void run(() => api('POST', `${url}/show`, { state: s }), `Showing ${s}.`)}>
                    {s}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <FieldGroup className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={id('name')}>Name</FieldLabel>
            <Input
              id={id('name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id('bot')}>Bot</FieldLabel>
            <BotSelect id={id('bot')} value={device.botId} bots={bots} onChange={(botId) => void patch({ botId }, 'Bot chosen.')} />
          </Field>
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel id={id('volume-label')}>Volume</FieldLabel>
              <span className="text-sm text-muted-foreground tabular-nums">{volume}</span>
            </div>
            <Slider
              aria-labelledby={id('volume-label')}
              value={[volume]} // a list: shadcn's slider draws one thumb per value
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setVolume(Array.isArray(v) ? v[0] : v)}
              onValueCommitted={(v) => {
                const next = Array.isArray(v) ? v[0] : v;
                if (next !== device.volume) void patch({ volume: next }, `Volume ${next}.`);
              }}
              className="py-2"
            />
          </Field>
          <Field orientation="horizontal" className="self-end">
            <Switch
              id={id('muted')}
              checked={device.muted}
              onCheckedChange={(muted) => void patch({ muted }, muted ? 'Muted.' : 'Sound on.')}
            />
            <FieldLabel htmlFor={id('muted')}>Muted</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor={id('longest')}>Longest message</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={id('longest')}
                inputMode="numeric"
                value={longest}
                onChange={(e) => setLongest(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={saveLongest}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <InputGroupAddon align="inline-end">seconds</InputGroupAddon>
            </InputGroup>
            <FieldDescription>Hold the screen to talk and let go to send. Listening also ends here (5–120 s).</FieldDescription>
          </Field>
        </FieldGroup>

        <Separator />
        <TryIt device={device} run={run} />
        <Separator />
        <DeviceWifi device={device} run={run} />
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2 border-t bg-muted/40">
        <span className="mr-auto text-xs text-muted-foreground">These can't be undone from here.</span>
        <ConfirmButton
          danger
          size="sm"
          disabled={!online}
          title={`Make ${device.name} forget all its Wi-Fi networks?`}
          description="It restarts and opens its setup network (Desk-Setup-…), where a phone can add a network. Its approval, bot and bridge address stay."
          confirm="Forget all networks"
          onConfirm={() => void run(() => api('POST', `${url}/forget-wifi`), 'It is restarting into Wi-Fi setup.')}
        >
          Forget all networks
        </ConfirmButton>
        <ConfirmButton
          danger
          size="sm"
          title={`Forget ${device.name}?`}
          description="Its key stops working and it disappears from this list. To use it again, approve it again when it reconnects."
          confirm="Forget device"
          onConfirm={() => void run(() => api('DELETE', url), 'Forgotten.')}
        >
          Forget
        </ConfirmButton>
      </CardFooter>
    </Card>
  );
}

function TryIt({ device, run }: { device: Device; run: Run }) {
  const key = `grok-puck-said-${device.id}`;
  const [text, setText] = useState('Hello from the desk bridge.');
  const [recent, setRecent] = useState(() => readList(key));
  const say = (sentence: string) => {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    setRecent(pushList(key, trimmed));
    void run(() => api('POST', `/api/devices/${enc(device.id)}/say`, { text: trimmed }));
  };
  return (
    <Field>
      <FieldLabel htmlFor={`${device.id}-say`}>Try it: speak a sentence on the device</FieldLabel>
      <InputGroup>
        <InputGroupInput id={`${device.id}-say`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && say(text)} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="secondary" size="xs" onClick={() => say(text)} disabled={!text.trim()}>
            <SendIcon /> Speak it
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Recent sentences">
          {recent.map((r) => (
            <Button key={r} variant="outline" size="xs" className="max-w-full truncate" onClick={() => setText(r)} title={r}>
              <span className="truncate">{r}</span>
            </Button>
          ))}
        </div>
      )}
    </Field>
  );
}
