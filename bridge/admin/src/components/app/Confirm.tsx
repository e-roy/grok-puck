// A button whose action is confirmed in a dialog that says what will happen. `danger` marks actions
// that lose something (red text on the button, a red confirm button).
import { type ReactNode, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ConfirmButton({
  children,
  title,
  description,
  confirm,
  onConfirm,
  disabled,
  danger,
  size,
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirm: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  size?: 'default' | 'sm';
}) {
  // Controlled, so confirming closes the dialog: the action is a plain button, and the button that
  // opened it may still be there afterwards (Replace the key) with whatever the action showed.
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="outline" size={size} disabled={disabled} className={cn(danger && 'text-destructive hover:text-destructive')} />}
      >
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? 'destructive' : 'default'}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
