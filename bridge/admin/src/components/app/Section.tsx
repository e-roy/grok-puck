// A section's heading and short explanation, and the props every section receives.
import type { ReactNode } from 'react';
import type { Overview } from '@/api.ts';
import type { Run } from '@/lib/run.ts';

export interface Voices {
  list: string[];
  error: string;
  loaded: boolean;
}

export interface SectionProps {
  data: Overview;
  run: Run;
  voices: Voices;
}

export function SectionHeader({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-prose">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
      </div>
      {action}
    </header>
  );
}

/** A small coloured dot with its meaning for screen readers. */
export function StatusDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center" title={label}>
      <span className={`size-2 rounded-full ${on ? 'bg-success' : 'bg-muted-foreground/40'}`} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
