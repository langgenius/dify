import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  RiArrowRightSLine,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { ChatItem, WorkflowProcess } from '../../types'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import cn from '@/utils/classnames'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'

type WorkflowProcessProps = {
  data: WorkflowProcess
  item?: ChatItem
  expand?: boolean
  hideInfo?: boolean
  hideProcessDetail?: boolean
}
const WorkflowProcessItem = ({
  data,
  item,
  expand = false,
  hideInfo = false,
  hideProcessDetail = false,
}: WorkflowProcessProps) => {
  const { t } = useTranslation()
  const [collapse, setCollapse] = useState(!expand)
  const running = data.status === WorkflowRunningStatus.Running
  const succeeded = data.status === WorkflowRunningStatus.Succeeded
  const failed = data.status === WorkflowRunningStatus.Failed || data.status === WorkflowRunningStatus.Stopped

  const background = useMemo(() => {
    if (collapse)
      return 'linear-gradient(90deg, rgba(200, 206, 218, 0.20) 0%, rgba(200, 206, 218, 0.04) 100%)'
    if (running && !collapse)
      return 'linear-gradient(180deg, #E1E4EA 0%, #EAECF0 100%)'

    if (succeeded && !collapse)
      return 'linear-gradient(180deg, #ECFDF3 0%, #F6FEF9 100%)'

    if (failed && !collapse)
      return 'linear-gradient(180deg, #FEE4E2 0%, #FEF3F2 100%)'
  }, [running, succeeded, failed, collapse])

  useEffect(() => {
    setCollapse(!expand)
  }, [expand])

  const setCurrentLogItem = useAppStore(s => s.setCurrentLogItem)
  const setShowMessageLogModal = useAppStore(s => s.setShowMessageLogModal)
  const setCurrentLogModalActiveTab = useAppStore(s => s.setCurrentLogModalActiveTab)

  const showIterationDetail = useCallback(() => {
    setCurrentLogItem(item)
    setCurrentLogModalActiveTab('TRACING')
    setShowMessageLogModal(true)
  }, [item, setCurrentLogItem, setCurrentLogModalActiveTab, setShowMessageLogModal])

  const showRetryDetail = useCallback(() => {
    setCurrentLogItem(item)
    setCurrentLogModalActiveTab('TRACING')
    setShowMessageLogModal(true)
  }, [item, setCurrentLogItem, setCurrentLogModalActiveTab, setShowMessageLogModal])

  return (
    <div
      className={cn(
        '-mx-1 px-2.5 rounded-xl border-[0.5px]',
        collapse ? 'py-[7px] border-components-panel-border' : 'pt-[7px] px-1 pb-1 border-components-panel-border-subtle',
      )}
      style={{
        background,
      }}
    >
      <div
        className={cn('flex items-center cursor-pointer', !collapse && 'px-1.5')}
        onClick={() => setCollapse(!collapse)}
      >
        {
          running && (
            <RiLoader2Line className='shrink-0 mr-1 w-3.5 h-3.5 text-text-tertiary' />
          )
        }
        {
          succeeded && (
            <CheckCircle className='shrink-0 mr-1 w-3.5 h-3.5 text-text-success' />
          )
        }
        {
          failed && (
            <RiErrorWarningFill className='shrink-0 mr-1 w-3.5 h-3.5 text-text-destructive' />
          )
        }
        <div className={cn('system-xs-medium text-text-secondary', !collapse && 'grow')}>
          {t('workflow.common.workflowProcess')}
        </div>
        <RiArrowRightSLine className={`'ml-1 w-4 h-4 text-text-tertiary' ${collapse ? '' : 'rotate-90'}`} />
      </div>
      {
        !collapse && (
          <div className='mt-1.5'>
            {
              <TracingPanel
                list={data.tracing}
                onShowIterationDetail={showIterationDetail}
                onShowRetryDetail={showRetryDetail}
                hideNodeInfo={hideInfo}
                hideNodeProcessDetail={hideProcessDetail}
              />
            }
          </div>
        )
      }
    </div>
  )
}

export default WorkflowProcessItem
