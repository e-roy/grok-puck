// Bots: one card per Grok Bot with its look (shape, colour), its voice, and its routine's webhook.
// Changes are kept in the card until Save; the device shows the look as soon as it is saved.
import { BotIcon, PlayIcon, PlusIcon, SendIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type Avatar as AvatarSettings, type Bot, type Shape } from '@/api.ts';
import { Avatar } from '@/components/app/Avatar.tsx';
import { ConfirmButton } from '@/components/app/Confirm.tsx';
import { SectionHeader, type SectionProps, type Voices } from '@/components/app/Section.tsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '@/components/ui/combobox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUnsaved } from '@/lib/dirty.ts';
import { enc } from '@/lib/format.ts';
import type { Run } from '@/lib/run.ts';
import { groupVoices, playSample, voiceName } from '@/lib/voices.ts';

const SWATCHES = [
  ['#f59e0b', 'amber'],
  ['#f97316', 'orange'],
  ['#ef4444', 'red'],
  ['#ec4899', 'pink'],
  ['#a855f7', 'purple'],
  ['#6366f1', 'indigo'],
  ['#3b82f6', 'blue'],
  ['#06b6d4', 'cyan'],
  ['#10b981', 'green'],
  ['#84cc16', 'lime'],
  ['#9ca3af', 'grey'],
] as const;

export function Bots({ data, run, voices }: SectionProps) {
  return (
    <>
      <SectionHeader title="Bots" action={<NewBot run={run} />}>
        One entry per Grok Bot. Its routine's webhook carries what you say to it; the avatar and voice are how the desk shows it.
      </SectionHeader>
      {voices.error && data.speech.tts.provider !== 'mock' && (
        <p className="mb-4 text-sm text-destructive">The voice list isn't available: {voices.error}</p>
      )}
      <div className="flex flex-col gap-4">
        {data.bots.map((bot) => (
          <BotCard key={bot.id} bot={bot} shapes={data.shapes} voices={voices} run={run} />
        ))}
        {data.bots.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>No bot yet</EmptyTitle>
              <EmptyDescription>Add your Grok Bot by the name it has in the app.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <NewBot run={run} />
            </EmptyContent>
          </Empty>
        )}
      </div>
    </>
  );
}

function NewBot({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const add = async () => {
    if (await run(() => api('POST', '/api/bots', { name: name.trim() }))) {
      setName('');
      setOpen(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon /> Add bot
      </DialogTrigger>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a bot</DialogTitle>
            <DialogDescription>Use the name it has in the Grok Bot app. A device without a bot gets this one.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="new-bot-name">Name</FieldLabel>
            <Input id="new-bot-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!name.trim()}>
              Add bot
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Form = Omit<Bot, 'id' | 'webhookKeySet'>;

function fromBot(bot: Bot): Form {
  const { id: _id, webhookKeySet: _set, ...rest } = bot;
  return { ...rest, webhookKey: '' };
}

function BotCard({ bot, shapes, voices, run }: { bot: Bot; shapes: Shape[]; voices: Voices; run: Run }) {
  const url = `/api/bots/${enc(bot.id)}`;
  const [form, setForm] = useState<Form>(() => fromBot(bot));
  const set = (changes: Partial<Form>) => setForm((f) => ({ ...f, ...changes }));
  const setAvatar = (changes: Partial<AvatarSettings>) => setForm((f) => ({ ...f, avatar: { ...f.avatar, ...changes } }));
  const saved = fromBot(bot);
  const dirty = JSON.stringify({ ...form, webhookKey: '' }) !== JSON.stringify(saved) || form.webhookKey !== '';
  useUnsaved(`bot-${bot.id}`, dirty);
  const id = (part: string) => `${bot.id}-${part}`;

  const save = async () => {
    const { webhookKey, ...rest } = form;
    if (await run(() => api('PATCH', url, { ...rest, ...(webhookKey ? { webhookKey } : {}) }), `${form.name} saved.`)) set({ webhookKey: '' });
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-4">
        <Avatar avatar={form.avatar} size={72} state="idle" />
        <div className="min-w-0">
          <CardTitle className="truncate">{form.name || 'Unnamed bot'}</CardTitle>
          <CardDescription>
            {bot.voice ? `Voice: ${voiceName(bot.voice)}` : 'No voice yet'} · {bot.webhookUrl ? 'webhook set' : 'no webhook yet'}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <Field>
          <FieldLabel htmlFor={id('name')}>Name in the Grok Bot app</FieldLabel>
          <Input id={id('name')} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Look</FieldLegend>
          <FieldDescription>What the device draws. Match it to the bot's avatar in the app.</FieldDescription>
          <ToggleGroup
            aria-label="Shape"
            value={[form.avatar.shape]}
            onValueChange={(v) => v[0] && setAvatar({ shape: v[0] as Shape })}
            variant="outline"
            spacing={2}
            className="flex-wrap"
          >
            {shapes.map((s) => (
              <ToggleGroupItem key={s} value={s} aria-label={s} className="h-auto flex-col gap-1 px-2 py-1.5">
                <Avatar avatar={{ shape: s, color: form.avatar.color }} size={36} />
                <span className="text-xs">{s}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Colour">
            {SWATCHES.map(([c, colourName]) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={form.avatar.color.toLowerCase() === c}
                aria-label={colourName}
                title={colourName}
                onClick={() => setAvatar({ color: c })}
                className="size-7 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-3 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground"
                style={{ background: c }}
              />
            ))}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="color"
                value={form.avatar.color}
                onChange={(e) => setAvatar({ color: e.target.value })}
                className="size-7 cursor-pointer rounded-full border bg-transparent p-0"
                aria-label="Any colour"
              />
              <span className="font-mono text-xs">{form.avatar.color}</span>
            </label>
          </div>
        </FieldSet>

        <Field>
          <FieldLabel htmlFor={id('voice')}>Voice</FieldLabel>
          <VoicePicker id={id('voice')} value={form.voice} voices={voices} onChange={(voice) => set({ voice })} run={run} />
          <FieldDescription>Play a voice to hear it; the device uses it once saved.</FieldDescription>
        </Field>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label">Grok Bot routine</FieldLegend>
          <FieldDescription>From the routine's webhook trigger in the Grok Bot app. The key is never shown again once saved.</FieldDescription>
          <FieldGroup className="grid gap-4 sm:grid-cols-[1fr_14rem]">
            <Field>
              <FieldLabel htmlFor={id('webhook')}>Webhook URL</FieldLabel>
              <Input id={id('webhook')} value={form.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://…" />
            </Field>
            <Field>
              <FieldLabel htmlFor={id('webhook-key')}>Webhook key</FieldLabel>
              <Input
                id={id('webhook-key')}
                type="password"
                value={form.webhookKey}
                onChange={(e) => set({ webhookKey: e.target.value })}
                placeholder={bot.webhookKeySet ? `saved (${bot.webhookKey})` : 'paste the key'}
                autoComplete="off"
              />
            </Field>
          </FieldGroup>
          <Field orientation="horizontal">
            <Switch id={id('recent')} checked={form.sendRecent} onCheckedChange={(sendRecent) => set({ sendRecent })} />
            <FieldLabel htmlFor={id('recent')} className="font-normal">
              Send the last few spoken exchanges with each message
            </FieldLabel>
          </Field>
          <TestMessage botUrl={url} run={run} disabled={!bot.webhookUrl} />
        </FieldSet>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2 border-t">
        <Button onClick={() => void save()} disabled={!dirty || !form.name.trim()}>
          Save
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setForm(fromBot(bot))}>
            Undo changes
          </Button>
        )}
        {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        <span className="ml-auto" />
        <ConfirmButton
          danger
          size="sm"
          title={`Delete ${bot.name}?`}
          description="Its devices are left without a bot until you choose another. Grok Bot itself is not changed."
          confirm="Delete bot"
          onConfirm={() => void run(() => api('DELETE', url), 'Bot deleted.')}
        >
          Delete
        </ConfirmButton>
      </CardFooter>
    </Card>
  );
}

function VoicePicker({ id, value, voices, onChange, run }: { id: string; value: string; voices: Voices; onChange: (v: string) => void; run: Run }) {
  const groups = useMemo(() => groupVoices(voices.list), [voices.list]);
  const play = (voice: string) => void run(() => playSample(voice), `Playing ${voiceName(voice)}.`);
  if (!voices.list.length) {
    return <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="voice id" />;
  }
  return (
    <div className="flex gap-2">
      <Combobox
        items={groups}
        value={value || null}
        // Clearing the search box is not choosing "no voice": keep the voice until another is picked.
        onValueChange={(v) => typeof v === 'string' && v && onChange(v)}
        itemToStringLabel={(v: string) => `${voiceName(v)} (${v})`}
        autoHighlight // the first match is highlighted, so Enter picks it
      >
        <ComboboxInput id={id} placeholder="Search voices" className="min-w-0 flex-1" />
        <ComboboxContent>
          <ComboboxEmpty>No voice matches.</ComboboxEmpty>
          <ComboboxList>
            {(group: { label: string; items: string[] }) => (
              <ComboboxGroup key={group.label} items={group.items}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(voice: string) => (
                    <ComboboxItem key={voice} value={voice}>
                      <span
                        role="presentation"
                        title={`Play ${voiceName(voice)}`}
                        className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          play(voice);
                        }}
                      >
                        <PlayIcon className="size-3" />
                      </span>
                      {voiceName(voice)}
                      <span className="text-xs text-muted-foreground">{voice}</span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon" disabled={!value} onClick={() => play(value)} aria-label="Play the chosen voice" />}>
          <PlayIcon />
        </TooltipTrigger>
        <TooltipContent>Play the chosen voice</TooltipContent>
      </Tooltip>
    </div>
  );
}

function TestMessage({ botUrl, run, disabled }: { botUrl: string; run: Run; disabled: boolean }) {
  const [text, setText] = useState('Hello! This is a test from the desk bridge.');
  const send = () => void run(() => api('POST', `${botUrl}/test`, { text }));
  return (
    <Field>
      <FieldLabel htmlFor={`${botUrl}-test`}>Send a test message to the bot</FieldLabel>
      <InputGroup>
        <InputGroupInput id={`${botUrl}-test`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !disabled && send()} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="secondary" size="xs" disabled={disabled || !text.trim()} onClick={send}>
            <SendIcon /> Send
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>{disabled ? 'Set and save the webhook first.' : 'As if you had said it to the desk; the reply is spoken on its devices.'}</FieldDescription>
    </Field>
  );
}
