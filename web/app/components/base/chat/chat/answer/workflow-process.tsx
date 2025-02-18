import {
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

type WorkflowProcessProps = {
  data: WorkflowProcess
  item?: ChatItem
  expand?: boolean
  hideInfo?: boolean
  hideProcessDetail?: boolean
  readonly?: boolean
}
const WorkflowProcessItem = ({
  data,
  expand = false,
  hideInfo = false,
  hideProcessDetail = false,
  readonly = false,
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

  return (
    <div
      className={cn(
        '-mx-1 rounded-xl border-[0.5px] px-2.5',
        collapse ? 'border-components-panel-border py-[7px]' : 'border-components-panel-border-subtle px-1 pb-1 pt-[7px]',
      )}
      style={{
        background,
      }}
    >
      <div
        className={cn('flex cursor-pointer items-center', !collapse && 'px-1.5', readonly && 'cursor-default')}
        onClick={() => !readonly && setCollapse(!collapse)}
      >
        {
          running && (
            <RiLoader2Line className='text-text-tertiary mr-1 h-3.5 w-3.5 shrink-0' />
          )
        }
        {
          succeeded && (
            <CheckCircle className='text-text-success mr-1 h-3.5 w-3.5 shrink-0' />
          )
        }
        {
          failed && (
            <RiErrorWarningFill className='text-text-destructive mr-1 h-3.5 w-3.5 shrink-0' />
          )
        }
        <div className={cn('system-xs-medium text-text-secondary', !collapse && 'grow')}>
          {t('workflow.common.workflowProcess')}
        </div>
        {!readonly && <RiArrowRightSLine className={`'ml-1 text-text-tertiary' h-4 w-4 ${collapse ? '' : 'rotate-90'}`} />}
      </div>
      {
        !collapse && !readonly && (
          <div className='mt-1.5'>
            {
              <TracingPanel
                list={data.tracing}
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
