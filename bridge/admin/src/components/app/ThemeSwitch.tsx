// The light / dark switch in the header of the admin page and the Listen page.
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { type ThemeChoice, useTheme } from '@/lib/theme.tsx';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Same as the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSwitch() {
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
