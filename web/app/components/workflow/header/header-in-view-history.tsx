import type { ViewHistoryProps } from './view-history'
import { Button } from '@langgenius/dify-ui/button'
import { Separator } from '@langgenius/dify-ui/separator'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import { useWorkflowRun } from '../hooks/use-workflow-run'
import { useWorkflowStore } from '../store'
import RunningTitle from './running-title'
import ViewHistory from './view-history'

export type HeaderInHistoryProps = {
  viewHistoryProps?: ViewHistoryProps
}
const HeaderInHistory = ({ viewHistoryProps }: HeaderInHistoryProps) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()

  const { handleLoadBackupDraft } = useWorkflowRun()

  const handleGoBackToEdit = useCallback(() => {
    handleLoadBackupDraft()
    workflowStore.setState({ historyWorkflowData: undefined })
  }, [workflowStore, handleLoadBackupDraft])

  return (
    <>
      <div>
        <RunningTitle />
      </div>
      <div className="flex items-center space-x-2">
        <ViewHistory {...viewHistoryProps} withText />
        <Separator decorative orientation="vertical" className="mx-auto h-3.5" />
        <Button variant="primary" onClick={handleGoBackToEdit}>
          <ArrowNarrowLeft className="size-4" />
          {t(($) => $['common.goBackToEdit'], { ns: 'workflow' })}
        </Button>
      </div>
    </>
  )
}

export default HeaderInHistory
