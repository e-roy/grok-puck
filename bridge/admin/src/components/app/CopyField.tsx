// A read-only value with a copy button.
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';

export function CopyField({ value, label, id }: { value: string; label: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // the browser refused; the value can still be selected by hand
    }
  };
  return (
    <InputGroup>
      <InputGroupInput id={id} readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
