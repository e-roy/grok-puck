// Unsaved changes. Every section stays mounted (switching sections only hides them), so edits survive
// moving around the page; leaving or reloading the page with unsaved edits asks first.
import { useEffect } from 'react';

const dirty = new Set<string>();

function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

/** Marks the form `id` as having unsaved changes while `isDirty` is true. */
export function useUnsaved(id: string, isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    dirty.add(id);
    if (dirty.size === 1) window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      dirty.delete(id);
      if (dirty.size === 0) window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [id, isDirty]);
}
