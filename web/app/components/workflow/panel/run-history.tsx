import { memo } from 'react'
import cn from 'classnames'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { WorkflowRunningStatus } from '../types'
import { CheckCircle, XClose } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import {
  useStore as useRunHistoryStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchWorkflowRunHistory } from '@/service/workflow'
import Loading from '@/app/components/base/loading'

const RunHistory = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const appDetail = useAppStore(state => state.appDetail)
  const workflowRunId = useRunHistoryStore(state => state.workflowRunId)
  const { data, isLoading } = useSWR(appDetail ? `/apps/${appDetail.id}/workflow-runs` : null, fetchWorkflowRunHistory)

  if (!appDetail)
    return null

  return (
    <div className='flex flex-col ml-2 w-[200px] h-full bg-white border-[0.5px] border-gray-200 shadow-xl rounded-l-2xl'>
      <div className='shrink-0 flex items-center justify-between px-4 pt-3 text-base font-semibold text-gray-900'>
        {t('workflow.common.runHistory')}
        <div
          className='flex items-center justify-center w-6 h-6 cursor-pointer'
          onClick={() => workflowStore.setState({ showRunHistory: false })}
        >
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
      </div>
      {
        isLoading && (
          <div className='grow flex items-center justify-center h-full'>
            <Loading />
          </div>
        )
      }
      <div className='grow p-2 overflow-y-auto'>
        {
          data?.data.map(item => (
            <div
              key={item.id}
              className={cn(
                'flex mb-0.5 px-2 py-[7px] rounded-lg hover:bg-primary-50 cursor-pointer',
                item.id === workflowRunId && 'bg-primary-50',
              )}
              onClick={() => workflowStore.setState({
                currentSequenceNumber: item.sequence_number,
                workflowRunId: item.id,
                runningStatus: item.status as WorkflowRunningStatus,
              })}
            >
              {
                appDetail?.mode === 'workflow' && item.status === WorkflowRunningStatus.Failed && (
                  <AlertCircle className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#F79009]' />
                )
              }
              {
                appDetail?.mode === 'workflow' && item.status === WorkflowRunningStatus.Succeeded && (
                  <CheckCircle className='mt-0.5 mr-1.5 w-3.5 h-3.5 text-[#12B76A]' />
                )
              }
              <div>
                <div
                  className={cn(
                    'flex items-center text-[13px] font-medium leading-[18px]',
                    item.id === workflowRunId && 'text-primary-600',
                  )}
                >
                  Test Run#{item.sequence_number}
                </div>
                <div className='flex items-center text-xs text-gray-500 leading-[18px]'>
                  {item.created_by_account.name} · {dayjs((item.finished_at || item.created_at) * 1000).fromNow()}
                </div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default memo(RunHistory)
