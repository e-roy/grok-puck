// Every action on the page answers with a toast: successes fade, errors stay until closed.
import { toast } from 'sonner';

/** Runs an admin action and reports it: `success` text, or the action's own message. */
export type Run = (action: () => Promise<{ message?: string } | unknown>, success?: string) => Promise<boolean>;

/** An error toast: red, and it stays until closed. */
export function showError(text: string): void {
  toast.error(text, { duration: Number.POSITIVE_INFINITY, closeButton: true });
}

export function makeRun(refresh: () => Promise<void>): Run {
  return async (action, success) => {
    try {
      const result = (await action()) as { message?: string } | undefined;
      toast.success(success ?? result?.message ?? 'Done.');
      await refresh();
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };
}
