import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useWorkflowStore,
} from '../store'
import {
  useWorkflowRun,
} from '../hooks'
import Divider from '../../base/divider'
import RunningTitle from './running-title'
import type { ViewHistoryProps } from './view-history'
import ViewHistory from './view-history'
import Button from '@/app/components/base/button'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'

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
      <div className='flex items-center space-x-2'>
        <ViewHistory {...viewHistoryProps} withText />
        <Divider type='vertical' className='mx-auto h-3.5' />
        <Button
          variant='primary'
          onClick={handleGoBackToEdit}
        >
          <ArrowNarrowLeft className='mr-1 h-4 w-4' />
          {t('workflow.common.goBackToEdit')}
        </Button>
      </div>
    </>
  )
}

export default HeaderInHistory
