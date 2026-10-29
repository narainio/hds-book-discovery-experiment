import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getModeRepository } from '@/lib/modes';
import type { NewModeInput } from '@/lib/modes';
import { MODE_NAME_MAX, validateModeName } from '@/lib/intention';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLabel: string;
  suggestedName: string;
  /** The recipe to save; copied by the repository. */
  recipe: Omit<NewModeInput, 'name'>;
  hasExampleBook: boolean;
  onSaved: (name: string) => void;
  disabled?: boolean;
}

/**
 * Save as a Mode: stores a reusable recipe and stays on the page. The trigger
 * is a Radix Dialog trigger, so Escape closes and focus returns to it.
 */
export function SaveModeDialog({ open, onOpenChange, triggerLabel, suggestedName, recipe, hasExampleBook, onSaved, disabled }: Props) {
  const [name, setName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setError(null);
    }
  }, [open, suggestedName]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const valid = validateModeName(name);
    if (!valid.ok) {
      setError(valid.message);
      return;
    }
    const result = getModeRepository().save({ ...recipe, name: valid.name });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onOpenChange(false);
    onSaved(result.mode.name);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button type="button" disabled={disabled} data-testid="button-save-mode"
          className="min-h-11 px-3 inline-flex items-center rounded-lg border border-border bg-card text-role-ui text-foreground hover:bg-secondary disabled:opacity-50">
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md bg-card" data-testid="dialog-save-mode">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle className="text-role-section-title font-serif text-left">{triggerLabel}</DialogTitle>
            <DialogDescription className="text-role-small text-muted-foreground text-left">
              A Mode saves a Filter so you can return to it later.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <label htmlFor="mode-name" className="block text-role-ui text-foreground mb-1.5">Mode name</label>
            <input
              id="mode-name"
              type="text"
              value={name}
              maxLength={MODE_NAME_MAX + 20}
              onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
              aria-invalid={!!error}
              aria-describedby={`mode-name-help${error ? ' mode-name-error' : ''}`}
              data-testid="input-mode-name"
              className="w-full h-12 px-3 text-role-ui rounded-lg border-2 border-border bg-background focus-visible:outline-none focus-visible:border-ring"
            />
            {error && <p id="mode-name-error" role="alert" className="mt-1.5 text-role-small text-destructive" data-testid="text-save-mode-error">{error}</p>}
            <p id="mode-name-help" className="mt-2 text-role-small text-muted-foreground" data-testid="text-save-mode-help">
              Saves what you’re looking for{hasExampleBook ? ' and the book in your Filter' : ''}. Your Cart, “Fewer like this” choices and result order aren’t saved. Saved in this browser only.
            </p>
          </div>
          <DialogFooter className="mt-5 gap-2">
            <button type="button" onClick={() => onOpenChange(false)} data-testid="button-save-mode-cancel"
              className="min-h-11 px-4 rounded-lg border border-border text-role-ui text-foreground hover:bg-secondary">
              Cancel
            </button>
            <button type="submit" data-testid="button-save-mode-confirm"
              className="min-h-11 px-5 rounded-lg bg-teal text-teal-foreground text-role-button hover:opacity-90">
              Save Mode
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
