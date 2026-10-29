import React, { useRef, useState } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { showComingSoon } from '@/components/coming-soon';
import { SETTINGS_AGENTS, SETTINGS_USERS } from '@/lib/demo-content';
import { resetDemo } from '@/lib/demo-reset';

const label = 'px-2 pt-2 pb-1 text-role-small font-semibold uppercase tracking-wide text-muted-foreground';
const item = 'min-h-11 cursor-pointer rounded-md px-3 text-role-ui text-foreground focus:bg-secondary';

export function SettingsMenu({ compact = false }: { compact?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button ref={triggerRef} type="button" aria-label={compact ? 'Settings' : undefined} data-testid="button-settings"
            className="min-h-11 min-w-11 px-2 md:px-3 inline-flex items-center justify-center gap-1.5 rounded-full text-role-ui font-semibold text-foreground hover:bg-white/70">
            <Settings className="w-5 h-5" aria-hidden="true" />
            {!compact && <>Settings <ChevronDown className="w-4 h-4" aria-hidden="true" /></>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5" data-testid="menu-settings">
          <DropdownMenuGroup>
            <DropdownMenuLabel className={label}>Controls</DropdownMenuLabel>
            <DropdownMenuItem className={item} onSelect={() => setConfirm(true)} data-testid="menu-reset-demo">Reset demo…</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className={label}>Users</DropdownMenuLabel>
            {SETTINGS_USERS.map((u) => (
              <DropdownMenuItem key={u} className={item} onSelect={() => showComingSoon('User switching')}>{u}</DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className={label}>Agents</DropdownMenuLabel>
            {SETTINGS_AGENTS.map((a) => (
              <DropdownMenuItem key={a} className={item} onSelect={() => showComingSoon('Agent support')}>{a}</DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="rounded-xl" onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus(); }} data-testid="dialog-reset-demo">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-role-subsection-title">Reset the demo?</AlertDialogTitle>
            <AlertDialogDescription className="text-role-body text-muted-foreground">
              This clears the Cart, saved filters and browsing in this browser, and starts fresh with “Books for Johnny”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="min-h-11 rounded-full px-5" data-testid="button-reset-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetDemo} className="min-h-11 rounded-full px-5 bg-teal text-teal-foreground hover:bg-teal/90" data-testid="button-reset-confirm">
              Reset demo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
