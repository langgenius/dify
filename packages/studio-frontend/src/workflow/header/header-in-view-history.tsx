import type { ViewHistoryProps } from '@/app/components/workflow/header/view-history'
import { Button } from '@langgenius/dify-ui/button'
import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import Divider from '@/app/components/base/divider/index'
import {
  useWorkflowRun,
} from '@/app/components/workflow/hooks/index'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store/index'
import RunningTitle from '@/app/components/workflow/header/running-title'
import ViewHistory from '@/app/components/workflow/header/view-history'

export type HeaderInHistoryProps = {
  viewHistoryProps?: ViewHistoryProps
}
const HeaderInHistory = ({
  viewHistoryProps,
}: HeaderInHistoryProps) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()

  const {
    handleLoadBackupDraft,
  } = useWorkflowRun()

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
        <Button
          variant="primary"
          onClick={handleGoBackToEdit}
        >
          <ArrowNarrowLeft className="mr-1 size-4" />
          {t('common.goBackToEdit', { ns: 'workflow' })}
        </Button>
      </div>
    </>
  )
}

export default HeaderInHistory
