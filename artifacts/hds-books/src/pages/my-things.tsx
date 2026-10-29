import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useYourFilter } from '@/hooks/use-your-filter';
import { useModes, useWorkingContext } from '@/hooks/use-working-context';
import { modeSummary } from '@/lib/modes';
import type { ModeDefinition } from '@/lib/modes';
import { contextSummary } from '@/lib/context-summary';
import { PLACEHOLDER_FILTERS, PLACEHOLDER_LISTS, PLACEHOLDER_SKUS } from '@/lib/demo-content';
import { ComingSoonButton, ComingSoonTag } from '@/components/coming-soon';

const rowCls = 'group w-full min-h-11 py-3 px-3 flex items-center gap-3 rounded-lg text-left';

function Placeholder({ label, feature, testId }: { label: string; feature: string; testId: string }) {
  return (
    <li>
      <ComingSoonButton feature={feature} data-testid={testId} className={`${rowCls} hover:bg-secondary`}>
        <span className="min-w-0 flex-1 text-role-ui text-muted-foreground break-words">{label}</span>
        <ComingSoonTag />
      </ComingSoonButton>
    </li>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="text-role-subsection-title text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function MyThings() {
  const [, setLoc] = useLocation();
  const { view } = useYourFilter();
  const { committed, actions } = useWorkingContext();
  const { modes, notice: modesNotice } = useModes();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [modeError, setModeError] = useState<{ id: string; message: string } | null>(null);

  const hasWorking = !!committed?.started && !!view;
  const activeFilter = hasWorking && (!!view?.filter.words || !!view?.filter.book || (view?.session.negativeCount ?? 0) > 0);
  const resumable = activeFilter || (hasWorking && (committed?.scrollY ?? 0) > 0);

  const openMode = async (mode: ModeDefinition) => {
    if (openingId) return;
    setOpeningId(mode.id);
    setModeError(null);
    const result = await actions.openMode(mode);
    setOpeningId(null);
    if (result.ok) setLoc('/discover');
    else setModeError({ id: mode.id, message: result.message });
  };

  return (
    <div className="px-4 md:px-8 pt-8 md:pt-12 w-full">
      <div className="max-w-[760px]">
        <h1 tabIndex={-1} className="text-role-page-title text-foreground focus:outline-none" data-testid="text-my-things-heading">My things</h1>

        {resumable && (
          <section className="mt-6" aria-label="Your current discovery">
            <Link href="/discover" data-testid="link-continue-discovering"
              className="group flex items-center justify-between gap-4 rounded-xl border border-card-border bg-secondary px-4 py-3 hover:border-input">
              <span className="min-w-0">
                <span className="block text-role-ui font-semibold text-foreground">Continue discovering</span>
                <span className="block text-role-small text-muted-foreground truncate" data-testid="text-continue-summary">
                  {contextSummary(committed, view?.filter ?? null, view?.session.negativeCount ?? 0)}
                </span>
              </span>
              <ArrowRight className="w-5 h-5 text-foreground shrink-0" aria-hidden="true" />
            </Link>
          </section>
        )}

        <Section id="my-filters-heading" title="My filters">
          {modesNotice && <p className="mt-2 text-role-small text-muted-foreground" data-testid="text-modes-notice">{modesNotice}</p>}
          {modes.length === 0 && (
            <div className="mt-2" data-testid="text-modes-empty">
              <p className="text-role-body text-foreground">No saved filters yet.</p>
              <p className="text-role-small text-muted-foreground">You can save a filter while discovering.</p>
            </div>
          )}
          <ul className="mt-3 divide-y divide-border border-y border-border" data-testid="list-modes">
            {modes.map((mode) => (
              <li key={mode.id} data-testid={`row-mode-${mode.id}`}>
                <button type="button" onClick={() => void openMode(mode)} disabled={!!openingId}
                  aria-busy={openingId === mode.id || undefined}
                  data-testid={`button-open-mode-${mode.id}`}
                  className={`${rowCls} hover:bg-secondary disabled:opacity-60 disabled:cursor-wait`}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-role-ui font-semibold text-foreground break-words">Filter – {mode.name}</span>
                    <span className="block text-role-small text-muted-foreground break-words">{modeSummary(mode)}</span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 inline-flex items-center gap-1.5 text-role-ui font-semibold text-teal">
                    {openingId === mode.id
                      ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                      : <>Open <ArrowRight className="w-4 h-4" /></>}
                  </span>
                </button>
                {modeError?.id === mode.id && (
                  <p role="alert" className="pb-3 text-role-small text-destructive">{modeError.message}</p>
                )}
              </li>
            ))}
            {PLACEHOLDER_FILTERS.map((name, i) => (
              <Placeholder key={name} label={`Filter – ${name}`} feature={`Filter – ${name}`} testId={`button-placeholder-filter-${i}`} />
            ))}
          </ul>
        </Section>

        <Section id="my-skus-heading" title="My personal SKUs">
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {PLACEHOLDER_SKUS.map((name, i) => <Placeholder key={name} label={name} feature="Personal SKUs" testId={`button-placeholder-sku-${i}`} />)}
          </ul>
        </Section>

        <Section id="my-lists-heading" title="My lists">
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {PLACEHOLDER_LISTS.map((name, i) => <Placeholder key={name} label={name} feature="Lists" testId={`button-placeholder-list-${i}`} />)}
          </ul>
        </Section>
      </div>
    </div>
  );
}
