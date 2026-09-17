import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { useWorkflowRefreshDraft } from '../hooks/use-workflow-refresh-draft'

const WorkflowDraftConflict = () => {
  const { t } = useTranslation()
  const isRefreshing = useStore((s) => s.isSyncingWorkflowDraft)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()

  const handleReload = async () => {
    setRefreshFailed(false)
    const refreshed = await handleRefreshWorkflowDraft(false, { resolveConflict: true })
    if (!refreshed) setRefreshFailed(true)
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-state-warning-active bg-state-warning-hover px-4 py-3">
      <div role="alert" className="min-w-0 flex-1 system-sm-regular text-text-secondary">
        <p className="system-sm-medium text-text-warning">
          {t(($) => $['draftConflict.message'], { ns: 'workflow' })}
        </p>
        <p>{t(($) => $['draftConflict.description'], { ns: 'workflow' })}</p>
        {refreshFailed && (
          <p className="text-text-destructive">
            {t(($) => $['draftConflict.reloadFailed'], { ns: 'workflow' })}
          </p>
        )}
      </div>
      <Button variant="secondary" loading={isRefreshing} onClick={handleReload}>
        {t(($) => $['draftConflict.reload'], { ns: 'workflow' })}
      </Button>
    </div>
  )
}

export default WorkflowDraftConflict
