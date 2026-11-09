// What is still missing before the desk works end to end, each item linking to where it is fixed.
// When everything is done it shrinks to a single "Ready" line.
import { CheckCircle2Icon, ChevronRightIcon, CircleIcon } from 'lucide-react';
import type { SectionProps } from '@/components/app/Section.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Step {
  done: boolean;
  label: string;
  hint: string;
  href: string;
}

export function steps({ data, voices }: Pick<SectionProps, 'data' | 'voices'>): Step[] {
  const { tts, stt } = data.speech;
  const voiced = data.bots.filter((b) => b.voice);
  return [
    {
      done: tts.provider === 'mock' || (voices.loaded && !voices.error && voices.list.length > 0),
      label: 'Text to speech answers',
      hint: voices.error ? `It doesn't answer: ${voices.error}` : 'Set its base URL and model, then Find models.',
      href: '#speech',
    },
    {
      done: stt.provider === 'mock' || Boolean(stt.baseUrl && stt.model),
      label: 'Speech to text is set up',
      hint: 'Choose its base URL and model.',
      href: '#speech',
    },
    {
      done: voiced.length > 0,
      label: 'A bot has a voice',
      hint: data.bots.length ? 'Choose a voice for your bot.' : 'Add a bot and choose its voice.',
      href: '#bots',
    },
    {
      done: data.devices.some((d) => d.status === 'approved' && data.bots.some((b) => b.id === d.botId)),
      label: 'A device is approved and has a bot',
      hint: 'Approve the device below and choose its bot.',
      href: '#devices',
    },
    {
      done: data.mcp.keySet,
      label: 'Grok Bot can call the bridge (MCP key)',
      hint: 'Create the MCP key for Grok Bot.',
      href: '#grok-bot',
    },
    {
      done: data.bots.some((b) => b.webhookUrl),
      label: "The bot's routine webhook is set",
      hint: "Paste the routine's webhook URL and key into the bot.",
      href: '#bots',
    },
  ];
}

export function Checklist(props: Pick<SectionProps, 'data' | 'voices'>) {
  // Wait for the voice list (it tells whether text to speech answers) rather than flash a missing step.
  if (props.data.speech.tts.provider !== 'mock' && !props.voices.loaded) return null;
  const list = steps(props);
  const left = list.filter((s) => !s.done).length;
  if (left === 0) {
    return (
      <p className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2Icon className="size-4 text-success" />
        Ready: speech, bot, device and Grok Bot are all set up.
      </p>
    );
  }
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Setup</CardTitle>
        <CardDescription>
          {left} of {list.length} steps left before the desk works end to end.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="-mx-2 flex flex-col">
          {list.map((s) => (
            <li key={s.label}>
              <a
                href={s.href}
                className="flex items-start gap-3 rounded-lg px-2 py-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {s.done ? (
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-label="done" />
                ) : (
                  <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="to do" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={s.done ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>{s.label}</span>
                  {!s.done && <span className="block text-xs text-muted-foreground">{s.hint}</span>}
                </span>
                {!s.done && <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
