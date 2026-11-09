// History: what the desk heard and said, newest first, with filters, and for each turn a small bar of
// where the time went (speech, STT, webhook, the bot's reply) so slow steps stand out.
import { CircleAlertIcon, HistoryIcon, type LucideIcon, MicIcon, SettingsIcon, TabletSmartphoneIcon, Volume2Icon } from 'lucide-react';
import { useState } from 'react';
import type { HistoryEntry } from '@/api.ts';
import { SectionHeader, type SectionProps } from '@/components/app/Section.tsx';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { seconds, when } from '@/lib/format.ts';
import { cn } from '@/lib/utils';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'voice', label: 'Voice' },
  { value: 'say', label: 'Spoken' },
  { value: 'errors', label: 'Errors' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];

const KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  voice: { label: 'Heard', icon: MicIcon },
  say: { label: 'Spoken', icon: Volume2Icon },
  error: { label: 'Error', icon: CircleAlertIcon },
  device: { label: 'Device', icon: TabletSmartphoneIcon },
  admin: { label: 'Admin', icon: SettingsIcon },
};

const STEPS = [
  { key: 'audio', label: 'speech', className: 'bg-chart-2' },
  { key: 'stt', label: 'STT', className: 'bg-chart-1' },
  { key: 'webhook', label: 'webhook', className: 'bg-chart-3' },
  { key: 'reply', label: 'bot reply', className: 'bg-chart-4' },
] as const;

export function History({ data }: SectionProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [device, setDevice] = useState('');
  const deviceName = (id?: string) => data.devices.find((d) => d.id === id)?.name ?? id ?? '';
  const botName = (id?: string) => data.bots.find((b) => b.id === id)?.name ?? '';
  const shown = data.history.filter((h) => {
    if (device && h.deviceId !== device) return false;
    if (filter === 'errors') return !h.ok;
    if (filter === 'voice' || filter === 'say') return h.kind === filter;
    return true;
  });
  const deviceItems = [{ value: '', label: 'All devices' }, ...data.devices.map((d) => ({ value: d.id, label: d.name }))];
  // Every bar uses the same scale (the longest turn shown, at least 5 s), so turns compare at a glance.
  const scale = Math.max(5000, ...shown.map((h) => STEPS.reduce((sum, s) => sum + (h.timings?.[s.key] ?? 0), 0)));

  return (
    <>
      <SectionHeader title="History">What the desk heard and said, newest first, with how long each step took.</SectionHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ToggleGroup aria-label="Show" value={[filter]} onValueChange={(v) => v[0] && setFilter(v[0] as Filter)} variant="outline" size="sm" spacing={0}>
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {data.devices.length > 1 && (
          <Select items={deviceItems} value={device} onValueChange={(v) => setDevice(String(v ?? ''))}>
            <SelectTrigger size="sm" aria-label="Device">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {deviceItems.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {shown.length} of {data.history.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>{data.history.length ? 'Nothing matches' : 'Nothing yet'}</EmptyTitle>
            <EmptyDescription>{data.history.length ? 'Try another filter.' : 'Voice messages, spoken replies and errors appear here.'}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y">
              {shown.map((h) => (
                <Entry key={h.id} entry={h} device={deviceName(h.deviceId)} bot={botName(h.botId)} scale={scale} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Entry({ entry: h, device, bot, scale }: { entry: HistoryEntry; device: string; bot: string; scale: number }) {
  const kind = KINDS[h.kind] ?? { label: h.kind, icon: SettingsIcon };
  const failed = !h.ok;
  const Icon = failed ? CircleAlertIcon : kind.icon;
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', failed ? 'text-destructive' : 'text-muted-foreground')} aria-label={failed ? 'failed' : kind.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{when(h.at)}</span>
          <span className={cn('font-medium', failed && 'text-destructive')}>{failed && h.kind !== 'error' ? `${kind.label}, failed` : kind.label}</span>
          {device && <span>{device}</span>}
          {bot && <span>· {bot}</span>}
        </div>
        {h.text && <p className={cn('mt-0.5 line-clamp-3 text-sm wrap-break-word', failed && 'text-destructive')}>{h.text}</p>}
        {h.detail && <p className={cn('text-xs wrap-break-word', failed && !h.text ? 'text-destructive' : 'text-muted-foreground')}>{h.detail}</p>}
        {h.timings && Object.keys(h.timings).length > 0 && <Timings timings={h.timings} scale={scale} />}
      </div>
    </li>
  );
}

function Timings({ timings, scale }: { timings: Record<string, number>; scale: number }) {
  const parts = STEPS.filter((s) => timings[s.key] !== undefined).map((s) => ({ ...s, ms: timings[s.key] }));
  const total = parts.reduce((sum, p) => sum + p.ms, 0);
  return (
    <div className="mt-2 max-w-md">
      {total > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {parts.map((p) => (
            <span key={p.key} className={p.className} style={{ width: `${(p.ms / scale) * 100}%` }} />
          ))}
        </div>
      )}
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1">
            <span className={cn('size-2 rounded-full', p.className)} aria-hidden />
            {p.label} {seconds(p.ms)}
          </span>
        ))}
      </p>
    </div>
  );
}
