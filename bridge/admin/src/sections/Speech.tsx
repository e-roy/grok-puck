// Speech: a card each for text to speech and speech to text. "Find models" asks the service which
// models it has (and fixes a base URL missing /v1); the status line says whether it answers.
import { CheckCircle2Icon, CircleAlertIcon, CircleDashedIcon, PlayIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { api, type Service } from '@/api.ts';
import { SectionHeader, type SectionProps, type Voices } from '@/components/app/Section.tsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useUnsaved } from '@/lib/dirty.ts';
import type { Run } from '@/lib/run.ts';
import { cn } from '@/lib/utils';
import { playSample } from '@/lib/voices.ts';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI-compatible' },
  { value: 'mock', label: 'Mock (for testing)' },
];

export function Speech({ data, run, voices }: SectionProps) {
  const testVoice = data.bots.find((b) => b.voice)?.voice ?? voices.list[0] ?? '';
  return (
    <>
      <SectionHeader title="Speech">
        "OpenAI-compatible" covers any service with OpenAI's audio API: a self-hosted Kokoro or Speaches server, OpenAI, Groq and others.
        The base URL usually ends in <code>/v1</code>. "Mock" needs no service and is for testing.
      </SectionHeader>
      <div className="flex flex-col gap-4">
        <ServiceCard which="tts" title="Text to speech" description="Turns the bot's replies into the voice the device plays." service={data.speech.tts} run={run} voices={voices} testVoice={testVoice} />
        <ServiceCard which="stt" title="Speech to text" description="Turns what you say into text for the bot." service={data.speech.stt} run={run} voices={voices} />
      </div>
    </>
  );
}

type ServiceWithExtras = Service & { language?: string; mockText?: string };
type Status = { kind: 'ok' | 'error' | 'unknown'; text: string };

function ServiceCard({
  which,
  title,
  description,
  service,
  run,
  voices,
  testVoice,
}: {
  which: 'tts' | 'stt';
  title: string;
  description: string;
  service: ServiceWithExtras;
  run: Run;
  voices: Voices;
  testVoice?: string;
}) {
  const fromService = (s: ServiceWithExtras) => ({ ...s, apiKey: '' });
  const [form, setForm] = useState(() => fromService(service));
  const set = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));
  const [models, setModels] = useState<string[]>([]);
  const [typing, setTyping] = useState(false); // typing a model name the list doesn't have
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<Status>();
  const id = (part: string) => `${which}-${part}`;

  const keys = ['provider', 'baseUrl', 'model', 'language', 'mockText'] as const;
  const dirty = keys.some((k) => (form[k] ?? '') !== (service[k] ?? '')) || form.apiKey !== '';
  useUnsaved(`speech-${which}`, dirty);

  const findModels = async () => {
    setFinding(true);
    try {
      const result = await api<{ models: string[]; baseUrl: string; message?: string }>('POST', '/api/speech/models', {
        which,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
      });
      setModels(result.models);
      setTyping(false);
      if (result.models.length === 0) {
        setFound({ kind: 'unknown', text: result.message ?? 'No models found: type the model name.' });
        return;
      }
      const fixedUrl = result.baseUrl !== form.baseUrl.trim().replace(/\/+$/, '');
      const count = `${result.models.length} model${result.models.length > 1 ? 's' : ''}`;
      setFound({
        kind: 'ok',
        text: `Connected${fixedUrl ? ' (/v1 added to the base URL)' : ''}. ${count} found: pick one, then Save.${result.message ? ` ${result.message}` : ''}`,
      });
      set({ baseUrl: result.baseUrl, ...(result.models.includes(form.model) ? {} : { model: result.models[0] }) });
    } catch (err) {
      setModels([]);
      setFound({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setFinding(false);
    }
  };

  const save = async (clearApiKey = false) => {
    const { apiKeySet: _set, apiKey, ...rest } = form;
    const ok = await run(() => api('PUT', '/api/speech', { [which]: { ...rest, ...(apiKey ? { apiKey } : {}), clearApiKey } }), `${title} saved.`);
    if (ok) set({ apiKey: '' });
  };

  // What the card says about the saved service.
  const status: Status =
    found ??
    (service.provider === 'mock'
      ? { kind: 'ok', text: 'Mock: no service is called.' }
      : which === 'tts'
        ? voices.error
          ? { kind: 'error', text: `It doesn't answer: ${voices.error}` }
          : voices.loaded
            ? { kind: 'ok', text: `Answers, with ${voices.list.length} voice${voices.list.length === 1 ? '' : 's'}.` }
            : { kind: 'unknown', text: 'Checking…' }
        : service.baseUrl && service.model
          ? { kind: 'unknown', text: 'Set up. It is tried when you next talk to the desk; Find models checks the connection.' }
          : { kind: 'unknown', text: 'Not set up yet: base URL and model.' });

  const openai = form.provider === 'openai';
  const modelItems = models.map((m) => ({ value: m, label: m }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <FieldGroup className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <Field>
            <FieldLabel htmlFor={id('provider')}>Service</FieldLabel>
            <Select items={PROVIDERS} value={form.provider} onValueChange={(v) => v && set({ provider: v as Service['provider'] })}>
              <SelectTrigger id={id('provider')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {openai ? (
            <Field>
              <FieldLabel htmlFor={id('url')}>Base URL</FieldLabel>
              <Input id={id('url')} value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://speech.example.com/v1" />
            </Field>
          ) : which === 'stt' ? (
            <Field>
              <FieldLabel htmlFor={id('mock')}>Mock transcript</FieldLabel>
              <Input id={id('mock')} value={form.mockText ?? ''} onChange={(e) => set({ mockText: e.target.value })} />
              <FieldDescription>What the mock "hears" every time.</FieldDescription>
            </Field>
          ) : (
            <span />
          )}
        </FieldGroup>

        {openai && (
          <FieldGroup className={cn('grid gap-4', which === 'stt' ? 'sm:grid-cols-[14rem_1fr_6rem]' : 'sm:grid-cols-[14rem_1fr]')}>
            <Field>
              <FieldLabel htmlFor={id('key')}>API key</FieldLabel>
              <Input
                id={id('key')}
                type="password"
                value={form.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                placeholder={service.apiKeySet ? `saved (${service.apiKey})` : 'none'}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={id('model')}>Model</FieldLabel>
              <div className="flex gap-2">
                {models.length > 0 && !typing ? (
                  <Select
                    items={[...modelItems, { value: '', label: 'Another (type its name)…' }]}
                    value={form.model}
                    onValueChange={(v) => (v ? set({ model: String(v) }) : setTyping(true))}
                  >
                    <SelectTrigger id={id('model')} className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelItems.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="">Another (type its name)…</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id={id('model')} value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder={which === 'tts' ? 'kokoro' : 'model id'} />
                )}
                <Button variant="outline" disabled={!form.baseUrl || finding} onClick={() => void findModels()}>
                  {finding ? <Spinner /> : <SearchIcon />} Find models
                </Button>
              </div>
            </Field>
            {which === 'stt' && (
              <Field>
                <FieldLabel htmlFor={id('language')}>Language</FieldLabel>
                <Input id={id('language')} value={form.language ?? ''} onChange={(e) => set({ language: e.target.value })} placeholder="en" />
              </Field>
            )}
          </FieldGroup>
        )}

        <StatusLine status={status} />
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2 border-t">
        <Button onClick={() => void save()} disabled={!dirty}>
          Save
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setForm(fromService(service))}>
            Undo changes
          </Button>
        )}
        {which === 'tts' && (
          <Button
            variant="outline"
            disabled={dirty || !testVoice}
            title={dirty ? 'Save first: the test uses the saved settings' : undefined}
            onClick={() => testVoice && void run(() => playSample(testVoice), 'Playing a test sentence.')}
          >
            <PlayIcon /> Play a test sentence
          </Button>
        )}
        <span className="ml-auto" />
        {service.apiKeySet && (
          <Button variant="ghost" size="sm" onClick={() => void save(true)}>
            Remove the saved key
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function StatusLine({ status }: { status: Status }) {
  const Icon = status.kind === 'ok' ? CheckCircle2Icon : status.kind === 'error' ? CircleAlertIcon : CircleDashedIcon;
  return (
    <p
      className={cn(
        'flex items-start gap-2 text-sm',
        status.kind === 'ok' ? 'text-muted-foreground' : status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
      role="status"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', status.kind === 'ok' && 'text-success')} />
      <span className="min-w-0 wrap-break-word">{status.text}</span>
    </p>
  );
}
