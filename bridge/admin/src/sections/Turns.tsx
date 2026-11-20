// History → Turns (spec §5.11): what the bot called for each message, in order and with times, checked
// against its standing instructions; newest first, with a filter by bot and Export. Read from the
// bridge only while it is on screen. A reply's text comes from its History entry, while History has it.
import { CircleCheckIcon, DownloadIcon, KeyboardIcon, ListChecksIcon, MicIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type CheckName, type Overview, type Turn } from '@/api.ts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { enc, seconds, when } from '@/lib/format.ts';
import { at, CHECKS, eventText } from '@/lib/turns.ts';
import { cn } from '@/lib/utils';

const REFRESH_MS = 2000;
const SHOWN = 100;

export function Turns({ data, active }: { data: Overview; active: boolean }) {
  const [bot, setBot] = useState('');
  const [list, setList] = useState<{ turns: Turn[]; total: number }>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let current = true;
    const load = () =>
      api<{ turns: Turn[]; total: number }>('GET', `/api/turns?limit=${SHOWN}${bot ? `&bot=${enc(bot)}` : ''}`).then(
        (r) => {
          if (!current) return;
          setList(r);
          setError('');
        },
        (err: Error) => current && setError(err.message),
      );
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [active, bot]);

  const botItems = [{ value: '', label: 'All bots' }, ...data.bots.map((b) => ({ value: b.name, label: b.name }))];
  const textOf = (id: number | undefined) => (id === undefined ? undefined : data.history.find((h) => h.id === id)?.text);
  const exportUrl = `/api/turns/export${bot ? `?bot=${enc(bot)}` : ''}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {data.bots.length > 1 && (
          <Select items={botItems} value={bot} onValueChange={(v) => setBot(String(v ?? ''))}>
            <SelectTrigger size="sm" aria-label="Bot">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {botItems.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="text-xs text-muted-foreground">
          {list ? (list.total > list.turns.length ? `the latest ${list.turns.length} of ${list.total}` : `${list.total} turns`) : ''}
        </span>
        <a href={exportUrl} download className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}>
          <DownloadIcon aria-hidden /> Export
        </a>
      </div>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlertIcon />
          <AlertDescription>Couldn&apos;t read the turns: {error}</AlertDescription>
        </Alert>
      )}
      {!list ? (
        <Skeleton className="h-48 w-full" aria-label="Loading" />
      ) : list.turns.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon />
            </EmptyMedia>
            <EmptyTitle>No turns yet</EmptyTitle>
            <EmptyDescription>Each message the bot works on appears here once it calls the desk tools, with what it called and when.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y">
              {list.turns.map((t) => (
                <TurnItem key={t.id} turn={t} reply={textOf(firstReply(t))} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function firstReply(turn: Turn): number | undefined {
  for (const e of turn.events) if ('call' in e && e.call === 'desk_say' && e.history !== undefined) return e.history;
  return undefined;
}

function TurnItem({ turn, reply }: { turn: Turn; reply: string | undefined }) {
  const failed = (Object.keys(CHECKS) as CheckName[]).filter((c) => turn.checks[c] === 'fail');
  const Kind = turn.kind === 'voice' ? MicIcon : KeyboardIcon;
  const t = turn.timings;
  const timing = [
    t.first_call_ms !== undefined && `first call ${seconds(t.first_call_ms)}`,
    t.reply_ms !== undefined && `reply ${seconds(t.reply_ms)}`,
    t.speech_wait_ms !== undefined && `speech starts ${seconds(t.speech_wait_ms)} later`,
    t.speech_ms !== undefined && `speech ${seconds(t.speech_ms)}`,
  ].filter(Boolean);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Kind className="size-4 shrink-0" aria-hidden />
        <span className="tabular-nums">{when(turn.start)}</span>
        <span className="font-medium text-foreground">{turn.bot || 'no bot named'}</span>
        <span>{turn.kind === 'voice' ? 'spoken message' : 'typed message'}</span>
        {turn.devices.length > 0 && <span>· {turn.devices.join(', ')}</span>}
        <span className="tabular-nums">· {seconds(t.total_ms ?? 0)}</span>
        <span className="ml-auto">
          {turn.open ? (
            <Badge variant="outline">open</Badge>
          ) : failed.length ? (
            <Badge variant="outline" className="gap-1">
              <TriangleAlertIcon className="text-warning" aria-hidden />
              {failed.length === 1 ? '1 flag' : `${failed.length} flags`}
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-success">
              <CircleCheckIcon aria-hidden />
              checks passed
            </Badge>
          )}
        </span>
      </div>
      {reply && <p className="mt-1 line-clamp-2 text-sm wrap-break-word">{reply}</p>}
      <ol className="mt-2 flex flex-col gap-0.5 text-xs" aria-label="What the bot called, in order">
        {turn.events.map((e, i) => {
          const line = eventText(e);
          return (
            <li key={i} className="flex gap-2">
              <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">{at(e.ms)}</span>
              <span className="min-w-0 wrap-break-word">
                <span className={cn('font-medium', line.bad && 'text-destructive')}>{line.what}</span>
                {line.detail && <span className="text-muted-foreground"> · {line.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {(failed.length > 0 || turn.notes.length > 0) && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs">
          {failed.map((c) => (
            <li key={c} className="flex gap-1.5">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="sr-only">Flag: </span>
                {CHECKS[c].failed}
              </span>
            </li>
          ))}
          {turn.notes.map((n) => (
            <li key={n} className="text-muted-foreground">
              {n}
            </li>
          ))}
        </ul>
      )}
      {timing.length > 0 && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{timing.join(' · ')}</p>}
    </li>
  );
}
