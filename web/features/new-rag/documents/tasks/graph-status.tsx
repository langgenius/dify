import type { BackgroundTask } from '../models'
import { useTranslation } from 'react-i18next'
import { taskGraphIsIncomplete } from '../model'

export function DocumentGraphStatus({ task }: { task: BackgroundTask }) {
  const { t } = useTranslation(['knowledgeTasks'])
  if (!taskGraphIsIncomplete(task)) return null
  const failed = task.semanticEnrichment?.state === 'failed'
  return (
    <p className="mt-1 system-xs-regular text-text-warning" role="status">
      {failed ? t(($) => $.graphRepairFailed) : t(($) => $.graphRepairPending)}
    </p>
  )
}
