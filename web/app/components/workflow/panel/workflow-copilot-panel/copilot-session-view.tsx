import type {
  CopilotActionKind,
  ProgressEntry,
  SessionView,
} from '@/app/components/workflow-copilot/types'
import type { ChecklistItem } from '@/app/components/workflow/hooks/use-checklist'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CHECKLIST_AWAIT_RECHECK_STATE,
  COPILOT_MANUAL_ACTION_KINDS,
} from '@/app/components/workflow-copilot/types'

function useActionLabels(): Record<CopilotActionKind, string> {
  const { t } = useTranslation()

  return {
    approve_repair: t(($) => $['copilot.actionApproveRepair'], { ns: 'workflow' }),
    run_verify: t(($) => $['copilot.actionRunVerify'], { ns: 'workflow' }),
    provide_testdata: t(($) => $['copilot.actionProvideTestdata'], { ns: 'workflow' }),
    publish: t(($) => $['copilot.actionPublish'], { ns: 'workflow' }),
    undo: t(($) => $['copilot.actionUndo'], { ns: 'workflow' }),
    re_fix: t(($) => $['copilot.actionReFix'], { ns: 'workflow' }),
    recheck: t(($) => $['copilot.checklistRecheckAction'], { ns: 'workflow' }),
  }
}

function SessionStatus({ view }: { view: SessionView }) {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg border border-components-panel-border bg-components-panel-bg px-3 py-2 system-xs-regular text-text-secondary">
      <div className="text-text-tertiary">
        {t(($) => $['copilot.sessionIdLabel'], { ns: 'workflow' })}
      </div>
      <div className="truncate text-right">{view.SessionID}</div>
      <div className="text-text-tertiary">
        {t(($) => $['copilot.sessionStateLabel'], { ns: 'workflow' })}
      </div>
      <div className="truncate text-right">{view.State}</div>
      <div className="text-text-tertiary">
        {t(($) => $['copilot.sessionVersionLabel'], { ns: 'workflow' })}
      </div>
      <div className="truncate text-right">{view.Version}</div>
      <div className="text-text-tertiary">
        {t(($) => $['copilot.sessionRunStatusLabel'], { ns: 'workflow' })}
      </div>
      <div className="truncate text-right">{view.RunStatus}</div>
      <div className="text-text-tertiary">
        {t(($) => $['copilot.sessionCanvasReadOnlyLabel'], { ns: 'workflow' })}
      </div>
      <div className="truncate text-right">{String(view.CanvasReadOnly)}</div>
      <div className="text-text-tertiary">
        {t(($) => $['copilot.sessionInterruptedLabel'], { ns: 'workflow' })}
      </div>
      <div className="truncate text-right">{String(view.Interrupted)}</div>
    </div>
  )
}

function ProgressLog({ entries }: { entries: ProgressEntry[] }) {
  const { t } = useTranslation()

  if (!entries.length) {
    return (
      <div className="system-xs-regular text-text-quaternary">
        {t(($) => $['copilot.progressEmpty'], { ns: 'workflow' })}
      </div>
    )
  }

  return (
    <div className="flex max-h-60 flex-col gap-y-1 overflow-y-auto rounded-lg border border-components-panel-border bg-components-panel-bg px-3 py-2">
      {entries.map((entry) => (
        <div key={entry.id} className="system-xs-regular text-text-secondary">
          <span className="text-text-accent">{entry.event}</span>
          {' · '}
          <span className="wrap-break-word">{JSON.stringify(entry.data)}</span>
        </div>
      ))}
    </div>
  )
}

function ChecklistRecheck({
  fixableItems,
  unfixableItems,
  onRecheck,
}: {
  fixableItems: ChecklistItem[]
  unfixableItems: ChecklistItem[]
  onRecheck: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-components-panel-border bg-components-panel-bg px-3 py-2">
      <div className="system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['copilot.checklistRecheckTitle'], { ns: 'workflow' })}
      </div>
      <div className="system-xs-regular text-text-tertiary">
        {t(($) => $['copilot.checklistRecheckDescription'], { ns: 'workflow' })}
      </div>
      {unfixableItems.length > 0 && (
        <div className="system-xs-regular text-text-quaternary">
          {t(($) => $['copilot.checklistUnfixableNote'], {
            ns: 'workflow',
            count: unfixableItems.length,
          })}
        </div>
      )}
      <Button variant="secondary" size="small" onClick={onRecheck}>
        {t(($) => $['copilot.checklistRecheckAction'], { ns: 'workflow' })}
        {fixableItems.length > 0 ? ` (${fixableItems.length})` : ''}
      </Button>
    </div>
  )
}

export type CopilotSessionViewProps = {
  view: SessionView
  progressLog: ProgressEntry[]
  onRunAction: (kind: CopilotActionKind) => void
  messageText: string
  onMessageTextChange: (value: string) => void
  onSendMessage: () => void
  fixableChecklistItems: ChecklistItem[]
  unfixableChecklistItems: ChecklistItem[]
  onRecheck: () => void
}

function CopilotSessionView({
  view,
  progressLog,
  onRunAction,
  messageText,
  onMessageTextChange,
  onSendMessage,
  fixableChecklistItems,
  unfixableChecklistItems,
  onRecheck,
}: CopilotSessionViewProps) {
  const { t } = useTranslation()
  const actionLabels = useActionLabels()

  return (
    <div className="flex flex-col gap-y-3 px-4 py-3">
      <SessionStatus view={view} />

      {view.State === CHECKLIST_AWAIT_RECHECK_STATE && (
        <ChecklistRecheck
          fixableItems={fixableChecklistItems}
          unfixableItems={unfixableChecklistItems}
          onRecheck={onRecheck}
        />
      )}

      <div className="flex flex-col gap-y-2">
        <div className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['copilot.progressTitle'], { ns: 'workflow' })}
        </div>
        <ProgressLog entries={progressLog} />
      </div>

      <div className="flex flex-col gap-y-2">
        <div className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['copilot.actionsTitle'], { ns: 'workflow' })}
        </div>
        <div className="flex flex-wrap gap-2">
          {COPILOT_MANUAL_ACTION_KINDS.map((kind) => (
            <Button key={kind} size="small" onClick={() => onRunAction(kind)}>
              {actionLabels[kind]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-x-2">
        <Input
          size="small"
          value={messageText}
          onChange={(e) => onMessageTextChange(e.target.value)}
          placeholder={t(($) => $['copilot.messagePlaceholder'], { ns: 'workflow' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && messageText.trim()) onSendMessage()
          }}
        />
        <Button size="small" disabled={!messageText.trim()} onClick={onSendMessage}>
          {t(($) => $['copilot.messageSend'], { ns: 'workflow' })}
        </Button>
      </div>
    </div>
  )
}

export default memo(CopilotSessionView)
