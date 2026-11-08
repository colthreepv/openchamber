import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { SessionSearchInput } from '@/components/session/SessionSearchInput';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import type { AssistantEntry, AssistantWorkSession } from '@/lib/assistants/assistantDirectory';
import { openAssistant, openWorkSession } from '@/lib/assistants/assistantActions';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';
import { useAssistantDirectory } from '@/stores/useAssistantStore';
import { useGlobalSessionStatusStore } from '@/sync/global-session-status';
import { useSessionUIStore } from '@/sync/session-ui-store';
import type { SessionOutcome } from '@/lib/opencode/model';
import { useI18n } from '@/lib/i18n';
import { useMinuteTickerNow } from '@/hooks/useDurationTicker';
import { useGlobalSessionsStore, refreshGlobalSessions } from '@/stores/useGlobalSessionsStore';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import { AssistantAvatar } from './AssistantAvatar';

/**
 * Assistants fork: the sidebar organised by assistant instead of by project.
 * Each assistant is a character (face, name, role) whose tap opens its one
 * long conversation; the work sessions it started, in any folder, fold out
 * under it. Everything no assistant owns waits in "Other sessions".
 *
 * Shared by the phone drawer (`MobileSessionsSheet`) and the desktop sidebar
 * (`MainLayout`); `variant` only changes sizes.
 */

const SHORT_UNITS: Array<[number, string]> = [
  [365 * 24 * 3600_000, 'y'],
  [30 * 24 * 3600_000, 'mo'],
  [7 * 24 * 3600_000, 'w'],
  [24 * 3600_000, 'd'],
  [3600_000, 'h'],
  [60_000, 'm'],
];

const formatAgo = (timestamp: number, now: number): string => {
  if (!timestamp) return '';
  const delta = Math.max(0, now - timestamp);
  for (const [size, unit] of SHORT_UNITS) {
    if (delta >= size) return `${Math.floor(delta / size)}${unit}`;
  }
  return '';
};

const matches = (query: string, ...values: Array<string | null | undefined>): boolean => {
  if (!query) return true;
  const needle = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(needle));
};

type Variant = 'phone' | 'desktop';

const WorkStatusMark: React.FC<{ running: boolean; outcome?: SessionOutcome }> = ({ running, outcome }) => {
  const { t } = useI18n();
  if (running) {
    return <span title={t('assistants.statusRunning')}><Icon name="circle" className="size-3.5 shrink-0 text-status-info" /></span>;
  }
  if (outcome === 'failed') {
    return <span title={t('assistants.statusFailed')}><Icon name="error-warning" className="size-3.5 shrink-0 text-status-error" /></span>;
  }
  if (outcome === 'succeeded') {
    return <span title={t('assistants.statusDone')}><Icon name="check" className="size-3.5 shrink-0 text-status-success" /></span>;
  }
  return <span title={t(outcome === 'interrupted' ? 'assistants.statusInterrupted' : 'assistants.statusIdle')} className="mx-[3px] size-2 shrink-0 rounded-full bg-muted-foreground" />;
};

const WorkRow: React.FC<{
  work: AssistantWorkSession;
  running: boolean;
  selected: boolean;
  now: number;
  variant: Variant;
  onOpen: () => void;
}> = ({ work, running, selected, now, variant, onOpen }) => {
  const { t } = useI18n();
  const title = work.session.title.trim() || t('assistants.untitled');
  const time = formatAgo(work.session.time.updated, now) || t('assistants.now');
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 text-start transition-colors',
        variant === 'phone' ? 'min-h-11' : 'min-h-8',
        selected ? 'bg-interactive-selection text-interactive-selection-foreground' : 'hover:bg-interactive-hover active:bg-interactive-active',
      )}
      title={`${title} — ${work.directory}`}
      style={{ touchAction: 'manipulation' }}
    >
      <WorkStatusMark running={running} outcome={work.session.outcome} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir="auto" className={cn('min-w-0 truncate typography-ui-label', running ? 'text-foreground' : 'oc-title-rest')}>{title}</span>
        {work.directoryName ? (
          <span dir="auto" className="max-w-full truncate typography-micro text-muted-foreground">
            {work.directoryName}
          </span>
        ) : null}
      </span>
      {time ? <span className="shrink-0 typography-micro tabular-nums text-muted-foreground">{time}</span> : null}
    </button>
  );
};

const AssistantCard: React.FC<{
  assistant: AssistantEntry;
  works: AssistantWorkSession[];
  runningIds: ReadonlySet<string>;
  currentSessionId: string | null;
  expanded: boolean;
  onToggle: () => void;
  now: number;
  variant: Variant;
  onNavigate: () => void;
}> = ({ assistant, works, runningIds, currentSessionId, expanded, onToggle, now, variant, onNavigate }) => {
  const { t } = useI18n();
  const canonicalId = assistant.canonicalSession?.id ?? null;
  const canonicalRunning = canonicalId ? runningIds.has(canonicalId) : false;
  const runningWorks = works.filter((work) => runningIds.has(work.session.id)).length;
  const selected = canonicalId !== null && canonicalId === currentSessionId;
  const avatarSize = variant === 'phone' ? 56 : 40;
  const time = assistant.lastActivity ? formatAgo(assistant.lastActivity, now) || t('assistants.now') : '';
  const [opening, setOpening] = React.useState(false);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openAssistant(assistant);
      onNavigate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('assistants.openFailed'));
    } finally {
      setOpening(false);
    }
  };

  const status = canonicalRunning
    ? t('assistants.working')
    : runningWorks > 0
      ? t('assistants.running', { count: runningWorks })
      : null;

  return (
    <div
      className={cn('rounded-2xl transition-colors', selected ? 'bg-interactive-selection' : 'oc-tile')}
    >
      <div className="flex items-center gap-1 pe-1.5">
        <button
          type="button"
          onClick={() => void open()}
          className={cn(
            'flex min-w-0 flex-1 items-center text-start',
            variant === 'phone' ? 'gap-3.5 py-3 ps-3' : 'gap-2.5 py-2 ps-2',
          )}
          disabled={opening}
          aria-busy={opening}
          aria-current={selected ? 'page' : undefined}
          aria-label={t('assistants.open', { name: assistant.name })}
          style={{ touchAction: 'manipulation' }}
        >
          <AssistantAvatar project={assistant.project} name={assistant.name} size={avatarSize} running={canonicalRunning} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                dir="auto"
                className={cn('min-w-0 truncate font-semibold text-foreground', variant === 'phone' ? 'text-[17px] leading-6' : 'typography-ui-label')}
              >
                {assistant.name}
              </span>
              {time ? <span className="ms-auto shrink-0 typography-micro tabular-nums text-muted-foreground">{time}</span> : null}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 typography-meta text-muted-foreground">
              {status ? (
                <>
                  <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--status-info)' }} aria-hidden />
                  <span className="shrink-0" style={{ color: 'var(--info-text, var(--status-info))' }}>{status}</span>
                  {assistant.role ? <span aria-hidden className="opacity-60">·</span> : null}
                </>
              ) : null}
              <span dir="auto" className="min-w-0 truncate">
                {assistant.role || (assistant.canonicalSession ? '' : t('assistants.startConversation'))}
              </span>
            </span>
          </span>
        </button>
        {works.length > 0 ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={t(expanded ? 'assistants.hideSessions' : 'assistants.showSessions', { name: assistant.name })}
            className={cn(
              'flex shrink-0 items-center gap-0.5 rounded-full px-2 typography-micro tabular-nums text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground',
              variant === 'phone' ? 'min-h-11 min-w-11' : 'h-7',
            )}
            style={{ touchAction: 'manipulation' }}
          >
            {works.length}
            <Icon name="arrow-down-s" className={cn('size-4 transition-transform duration-150', !expanded && '-rotate-90 rtl:rotate-90')} />
          </button>
        ) : null}
      </div>
      {expanded && works.length > 0 ? (
        <div className={cn('flex flex-col gap-0.5 pb-2', variant === 'phone' ? 'ps-[74px] pe-2' : 'ps-[52px] pe-1.5')}>
          {works.map((work) => (
            <WorkRow
              key={work.session.id}
              work={work}
              running={runningIds.has(work.session.id)}
              selected={work.session.id === currentSessionId}
              now={now}
              variant={variant}
              onOpen={() => {
                void openWorkSession(work.session).then((opened) => { if (opened) onNavigate(); })
                  .catch((error) => toast.error(error instanceof Error ? error.message : t('assistants.openFailed')));
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

type AssistantSidebarProps = {
  variant: Variant;
  /** Called after a session opened (the phone drawer closes). */
  onNavigate?: () => void;
  onCreateAssistant: () => void;
  /** Phone: the drawer is on screen (the search field gets its focus scope). */
  active?: boolean;
  /** Desktop: a header row with the actions the phone keeps in its drawer header. */
  headerActions?: React.ReactNode;
};

export const AssistantSidebar: React.FC<AssistantSidebarProps> = ({ variant, onNavigate, onCreateAssistant, active = true, headerActions }) => {
  const { t } = useI18n();
  const { assistants, otherSessions } = useAssistantDirectory();
  const loadStatus = useGlobalSessionsStore((state) => state.status);
  const hasLoaded = useGlobalSessionsStore((state) => state.hasLoaded);
  const runningIds = useGlobalSessionStatusStore((state) => state.activeSessionIds);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [othersOpen, setOthersOpen] = React.useState<boolean | undefined>(undefined);
  const now = useMinuteTickerNow(active);
  const navigate = React.useCallback(() => onNavigate?.(), [onNavigate]);

  const trimmedQuery = query.trim();
  const visibleAssistants = assistants
    .map((assistant) => {
      const nameMatches = matches(trimmedQuery, assistant.name, assistant.role);
      const works = nameMatches
        ? assistant.workSessions
        : assistant.workSessions.filter((work) => matches(trimmedQuery, work.session.title, work.directoryName));
      return { assistant, works, visible: nameMatches || works.length > 0 };
    })
    .filter((entry) => entry.visible);
  const visibleOthers = otherSessions.filter((work) => matches(trimmedQuery, work.session.title, work.directory));
  // A running work or the open session unfolds its assistant until the user folds it.
  const isExpanded = (assistant: AssistantEntry, works: AssistantWorkSession[]): boolean => {
    const explicit = expanded[assistant.projectId];
    if (explicit !== undefined) return explicit;
    if (trimmedQuery) return works.length > 0;
    return works.some((work) => runningIds.has(work.session.id) || work.session.id === currentSessionId);
  };
  const othersExpanded = othersOpen ?? ((Boolean(trimmedQuery) && visibleOthers.length > 0)
    || visibleOthers.some((work) => work.session.id === currentSessionId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {variant === 'desktop' ? (
        <div className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-2">
          <span className="typography-ui-label font-semibold text-foreground">{t('assistants.title')}</span>
          <div className="ms-auto flex items-center gap-1">{headerActions}</div>
        </div>
      ) : null}
      <div className={cn('shrink-0 px-3', variant === 'phone' ? 'pb-2 pt-1' : 'pb-2 pt-1')}>
        <SessionSearchInput
          value={query}
          onSearch={setQuery}
          active={active}
          mobile={variant === 'phone'}
          placeholder={t('assistants.search')}
          clearLabel={t('assistants.clearSearch')}
        />
      </div>
      <ScrollableOverlay outerClassName="min-h-0 flex-1" className="pb-6" useScrollShadow disableHorizontal>
        <div className={cn('flex flex-col', variant === 'phone' ? 'gap-2.5 px-3' : 'gap-1.5 px-2')}>
          {loadStatus === 'error' ? (
            <div role="alert" className="flex items-center justify-between gap-2 p-2 typography-meta text-status-error">
              <span>{t('assistants.loadFailed')}</span>
              <Button variant="ghost" size="sm" onClick={() => void refreshGlobalSessions()}>{t('assistants.retry')}</Button>
            </div>
          ) : !hasLoaded ? (
            <div role="status" className="flex items-center gap-2 p-2 typography-meta text-muted-foreground">
              <Spinner className="size-4" />{t('assistants.loading')}
            </div>
          ) : null}
          {visibleAssistants.map(({ assistant, works }) => (
            <AssistantCard
              key={assistant.projectId}
              assistant={assistant}
              works={works}
              runningIds={runningIds}
              currentSessionId={currentSessionId}
              expanded={isExpanded(assistant, works)}
              onToggle={() => setExpanded((current) => ({ ...current, [assistant.projectId]: !isExpanded(assistant, works) }))}
              now={now}
              variant={variant}
              onNavigate={navigate}
            />
          ))}
          {!trimmedQuery ? (
            <button
              type="button"
              onClick={onCreateAssistant}
              className={cn(
                'flex items-center gap-3 rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--foreground)_16%,transparent)] text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground',
                variant === 'phone' ? 'px-3 py-3' : 'px-2 py-2',
              )}
              style={{ touchAction: 'manipulation' }}
            >
              <span
                className="flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]"
                style={{ width: variant === 'phone' ? 56 : 40, height: variant === 'phone' ? 56 : 40 }}
              >
                <Icon name="add" className="size-5" />
              </span>
              <span className="typography-ui-label">{t('assistants.new')}</span>
            </button>
          ) : null}
          {trimmedQuery && visibleAssistants.length === 0 && visibleOthers.length === 0 ? (
            <p className="px-2 py-6 text-center typography-meta text-muted-foreground">{t('assistants.noMatches', { query: trimmedQuery })}</p>
          ) : null}

          {visibleOthers.length > 0 ? (
            <div className="mt-5 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setOthersOpen(!othersExpanded)}
                aria-expanded={othersExpanded}
                className={cn('flex items-center gap-1 px-2 py-1.5 text-start typography-ui-label text-muted-foreground transition-colors hover:text-foreground', variant === 'phone' && 'min-h-11')}
                style={{ touchAction: 'manipulation' }}
              >
                <span>{t('assistants.otherSessions')}</span>
                <span className="typography-micro tabular-nums">{visibleOthers.length}</span>
                <Icon name="arrow-down-s" className={cn('size-4 transition-transform duration-150', !othersExpanded && '-rotate-90 rtl:rotate-90')} />
              </button>
              {othersExpanded ? visibleOthers.map((work) => (
                <WorkRow
                  key={work.session.id}
                  work={work}
                  running={runningIds.has(work.session.id)}
                  selected={work.session.id === currentSessionId}
                  now={now}
                  variant={variant}
                  onOpen={() => {
                    void openWorkSession(work.session).then((opened) => { if (opened) navigate(); })
                      .catch((error) => toast.error(error instanceof Error ? error.message : t('assistants.openFailed')));
                  }}
                />
              )) : null}
            </div>
          ) : null}
        </div>
      </ScrollableOverlay>
    </div>
  );
};
