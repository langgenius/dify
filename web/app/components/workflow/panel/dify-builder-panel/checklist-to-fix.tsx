import type { ChecklistItem } from '@/app/components/workflow/hooks/use-checklist'
import { Button } from '@langgenius/dify-ui/button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

export type ChecklistToFixProps = {
  fixableItems: ChecklistItem[]
  unfixableItems: ChecklistItem[]
  canStartChecklistFix: boolean
  isStarting: boolean
  onStartChecklistFix: () => void
}

// Sibling entry point to `RunToFix`: offers to start a checklist-fix session
// for the pre-publish checklist issues `useChecklist` currently reports on
// this app's draft, alongside the existing failed-run entry.
function ChecklistToFix({
  fixableItems,
  unfixableItems,
  canStartChecklistFix,
  isStarting,
  onStartChecklistFix,
}: ChecklistToFixProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-y-3 px-4 py-3">
      <div className="system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['difyBuilder.checklistFixTitle'], { ns: 'workflow' })}
      </div>
      <div className="rounded-lg border border-components-panel-border bg-components-panel-bg px-3 py-2">
        <div className="system-sm-regular text-text-secondary">
          {t(($) => $['difyBuilder.checklistFixSummary'], {
            ns: 'workflow',
            count: fixableItems.length,
          })}
        </div>
        {unfixableItems.length > 0 && (
          <div className="mt-1 system-xs-regular text-text-quaternary">
            {t(($) => $['difyBuilder.checklistUnfixableNote'], {
              ns: 'workflow',
              count: unfixableItems.length,
            })}
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        size="small"
        disabled={!canStartChecklistFix || isStarting}
        loading={isStarting}
        onClick={onStartChecklistFix}
      >
        {isStarting
          ? t(($) => $['difyBuilder.starting'], { ns: 'workflow' })
          : t(($) => $['difyBuilder.checklistFixAction'], {
              ns: 'workflow',
              count: fixableItems.length,
            })}
      </Button>
    </div>
  )
}

export default memo(ChecklistToFix)
