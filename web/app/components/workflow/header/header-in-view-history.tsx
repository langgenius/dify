import type { ViewHistoryProps } from './view-history'
import { Button } from '@langgenius/dify-ui/button'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '../../base/divider'
import { useWorkflowRun } from '../hooks/use-workflow-run'
import { useWorkflowStore } from '../store'
import RunningTitle from './running-title'
import ViewHistory from './view-history'

export type HeaderInHistoryProps = {
  viewHistoryProps?: ViewHistoryProps
  trailing?: React.ReactNode
}
const HeaderInHistory = ({ viewHistoryProps, trailing }: HeaderInHistoryProps) => {
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
        <Divider type="vertical" className="mx-auto h-3.5" />
        <Button variant="primary" onClick={handleGoBackToEdit}>
          <span aria-hidden className="i-custom-vender-line-arrows-arrow-narrow-left size-4" />
          {t(($) => $['common.goBackToEdit'], { ns: 'workflow' })}
        </Button>
        {trailing}
      </div>
    </>
  )
}

export default HeaderInHistory
