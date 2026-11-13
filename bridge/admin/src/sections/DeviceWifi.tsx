// A device card's Wi-Fi part: the networks the device has saved (it reports only their names), the
// one in use and its signal, Forget for each, and Wi-Fi setup, which opens the device's own setup
// network so a phone can add a network there. Wi-Fi passwords never pass through the bridge.
import { type LucideIcon, RouterIcon, WifiHighIcon, WifiIcon, WifiLowIcon } from 'lucide-react';
import { api, type Device } from '@/api.ts';
import { ConfirmButton } from '@/components/app/Confirm.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ago, enc } from '@/lib/format.ts';
import type { Run } from '@/lib/run.ts';

const MAX_NETWORKS = 5;

/** How a signal level reads, with an icon to match (lucide's no-bar icon is a lone dot, so weak keeps one bar). */
function signal(rssi: number): { word: string; Icon: LucideIcon } {
  if (rssi >= -55) return { word: 'strong', Icon: WifiIcon };
  if (rssi >= -67) return { word: 'good', Icon: WifiHighIcon };
  if (rssi >= -75) return { word: 'fair', Icon: WifiLowIcon };
  return { word: 'weak', Icon: WifiLowIcon };
}

export function DeviceWifi({ device, run }: { device: Device; run: Run }) {
  const wifi = device.wifi;
  const labelId = `${device.id}-wifi`;
  if (!wifi) {
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Wi-Fi:</span> this firmware doesn&apos;t report its saved networks. Firmware 0.6.0 and
        later do, and can be managed from here.
      </p>
    );
  }
  const url = `/api/devices/${enc(device.id)}`;
  const online = device.online;
  const inUse = online ? wifi.current : null;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span id={labelId} className="text-sm font-medium">
          Wi-Fi
        </span>
        {online && wifi.setup && <Badge variant="secondary">setup network open</Badge>}
        <Button variant="outline" size="sm" className="ml-auto" disabled={!online} onClick={() => void run(() => api('POST', `${url}/wifi-setup`))}>
          <RouterIcon aria-hidden /> Wi-Fi setup
        </Button>
      </div>
      {wifi.saved.length > 0 ? (
        <ItemGroup className="gap-2">
          {wifi.saved.map((ssid) => (
            <Network
              key={ssid}
              device={device}
              ssid={ssid}
              inUse={ssid === inUse}
              rssi={ssid === inUse ? wifi.rssi : null}
              others={wifi.saved.length - 1}
              run={run}
            />
          ))}
        </ItemGroup>
      ) : (
        <p className="text-sm text-muted-foreground">No saved networks.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {wifi.saved.length} of {MAX_NETWORKS} saved{online ? '' : `, as it reported ${ago(wifi.at)}`}. Networks are added on the device&apos;s own
        setup page: Wi-Fi setup opens it for 10 minutes, so Wi-Fi passwords never pass through the bridge.
      </p>
    </div>
  );
}

function Network({
  device,
  ssid,
  inUse,
  rssi,
  others,
  run,
}: {
  device: Device;
  ssid: string;
  inUse: boolean;
  rssi: number | null;
  others: number;
  run: Run;
}) {
  const level = rssi === null ? undefined : signal(rssi);
  const Icon = level?.Icon ?? WifiIcon;
  const name = device.name;
  const what = !inUse
    ? `${name} stops joining it. To use it again, add it on the device's setup page.`
    : others > 0
      ? `${name} is using this network now: it leaves it and joins another saved network. If none is in reach, it opens its setup network.`
      : `It is the only saved network, so ${name} goes offline and opens its setup network (Desk-Setup-…), where a phone can add another.`;
  return (
    <Item variant="outline" size="sm" role="listitem">
      <ItemMedia variant="icon" className={inUse ? undefined : 'text-muted-foreground'}>
        <Icon aria-hidden />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="truncate">{ssid}</span>
          {inUse && <Badge variant="secondary">in use</Badge>}
        </ItemTitle>
        {level && (
          <ItemDescription>
            Signal {level.word}, {rssi} dBm
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        <ConfirmButton
          danger
          size="sm"
          label={`Forget ${ssid}`}
          disabled={!device.online}
          title={`Forget "${ssid}" on ${name}?`}
          description={what}
          confirm="Forget network"
          onConfirm={() => void run(() => api('POST', `/api/devices/${enc(device.id)}/forget-network`, { ssid }))}
        >
          Forget
        </ConfirmButton>
      </ItemActions>
    </Item>
  );
}
