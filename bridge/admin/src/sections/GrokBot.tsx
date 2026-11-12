// Grok Bot: what to give the Grok Bot app (the MCP URL, header and key), the setup steps of the spec's
// §6, and the recent MCP calls with their technical details folded away.
import { ChevronDownIcon, KeyRoundIcon, PlugIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { api, type McpCall } from '@/api.ts';
import { ConfirmButton } from '@/components/app/Confirm.tsx';
import { CopyField } from '@/components/app/CopyField.tsx';
import { SectionHeader, type SectionProps } from '@/components/app/Section.tsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { ago, when } from '@/lib/format.ts';

export function GrokBot({ data, run }: SectionProps) {
  const [key, setKey] = useState('');
  const create = () =>
    void run(async () => setKey((await api<{ key: string }>('POST', '/api/mcp-key', {})).key), 'New MCP key created. Copy it now: it is shown only once.');
  const webhooks = data.bots.filter((b) => b.webhookUrl.startsWith('https://'));
  const accepted = data.mcp.calls.filter((c) => !c.refused);
  const lastCall = accepted[0];
  const lastRefused = data.mcp.calls[0]?.refused ? data.mcp.calls[0] : undefined;
  // Only a session's first call (initialize) names the client; later calls in it don't.
  const lastClient = accepted.find((c) => c.client)?.client;
  const callStatus = lastCall
    ? `last call ${ago(lastCall.at)}${lastClient ? ` from ${lastClient}` : ''}`
    : lastRefused
      ? `refused ${ago(lastRefused.at)}: wrong key or header`
      : 'no calls yet';

  return (
    <>
      <SectionHeader title="Grok Bot">
        Grok Bot talks to the desk through this bridge's MCP server, and the desk talks to Grok Bot through a routine's webhook.
      </SectionHeader>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>Add the bridge to Grok Bot as a custom remote MCP server, with this header.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="mcp-url">MCP server URL</FieldLabel>
              <CopyField id="mcp-url" label="the MCP server URL" value={data.mcp.url} />
              <FieldDescription>Grok Bot needs a public https address: this becomes the tunnel's address once the bridge runs on the always-on host.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="mcp-header">Header</FieldLabel>
              <CopyField id="mcp-header" label="the header" value="Authorization: Bearer <key>" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm">{data.mcp.keySet ? 'A key exists. It is shown only when created.' : 'No key yet: Grok Bot cannot call the bridge.'}</span>
              {data.mcp.keySet ? (
                <ConfirmButton
                  danger
                  size="sm"
                  title="Replace the MCP key?"
                  description="The current key stops working at once, so Grok Bot needs the new one in its MCP server settings."
                  confirm="Replace the key"
                  onConfirm={create}
                >
                  Replace the key
                </ConfirmButton>
              ) : (
                <Button size="sm" onClick={create}>
                  Create the key
                </Button>
              )}
            </div>
            {key && (
              <Alert>
                <TriangleAlertIcon />
                <AlertTitle>Copy the key now</AlertTitle>
                <AlertDescription className="flex w-full flex-col gap-2">
                  It is not shown again. Put it in Grok Bot's MCP server header in place of &lt;key&gt;.
                  <CopyField id="mcp-key" label="the key" value={key} />
                  <Button variant="ghost" size="sm" className="self-start" onClick={() => setKey('')}>
                    Hide it
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setup in the Grok Bot app</CardTitle>
            <CardDescription>Each step is done by you in the app. The skill and routine texts are written when Grok Bot is connected (M2).</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              <SetupStep n={1} title="Custom MCP server" done={Boolean(lastCall)} status={callStatus}>
                Ask your bot in chat to add the MCP server above, with the header; the app shows a confirmation card.
              </SetupStep>
              <SetupStep n={2} title={'Skill "Desk display"'} status="text comes in M2">
                Standing instructions: report <code>desk_status</code> while working, and call <code>desk_say</code> with every reply.
              </SetupStep>
              <SetupStep
                n={3}
                title={'Routine "Desk voice"'}
                done={webhooks.length > 0}
                status={webhooks.length ? `webhook set on ${webhooks.map((b) => b.name).join(', ')}` : 'no https webhook on a bot yet'}
              >
                A routine with a webhook trigger: what you say arrives there. Paste its webhook URL and key into the bot under{' '}
                <a href="#bots" className="underline underline-offset-4">
                  Bots
                </a>
                .
              </SetupStep>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent calls</CardTitle>
            <CardDescription>What called the MCP server, newest first, including calls refused for their key.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.mcp.calls.length === 0 ? (
              <Empty className="py-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PlugIcon />
                  </EmptyMedia>
                  <EmptyTitle>No calls yet</EmptyTitle>
                  <EmptyDescription>They appear here once Grok Bot (or the fake Grok Bot) connects.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="-mx-2 flex flex-col">
                {data.mcp.calls.map((c) => (
                  // Keyed by the call, not its place: new calls arrive on top, and an open row stays open.
                  <CallRow key={`${c.at}|${c.tool}|${c.methods.join(',')}|${c.client}`} call={c} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SetupStep({ n, title, done, status, children }: { n: number; title: string; done?: boolean; status: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium" aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          <Badge variant={done ? 'secondary' : 'outline'} className={done ? 'text-success' : 'text-muted-foreground'}>
            {status}
          </Badge>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function CallRow({ call }: { call: McpCall }) {
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">{when(call.at)}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{call.tool || call.methods.join(', ')}</span>
          {call.refused && (
            <Badge variant="outline" className="text-destructive">
              refused
            </Badge>
          )}
          {call.client && <span className="hidden truncate text-xs text-muted-foreground sm:block">{call.client}</span>}
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="mx-2 mb-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs">
            {call.refused && (
              <>
                <dt className="text-muted-foreground">Refused</dt>
                <dd className="font-mono break-all">{call.refused}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Client</dt>
            <dd>{call.client || '—'}</dd>
            <dt className="text-muted-foreground">User agent</dt>
            <dd className="break-all">{call.userAgent || '—'}</dd>
            <dt className="text-muted-foreground">Arguments</dt>
            <dd className="font-mono break-all">{call.argumentNames.join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">Headers</dt>
            <dd className="font-mono break-all">{call.headerNames.join(', ')}</dd>
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
