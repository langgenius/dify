import type { ChatItem, WorkflowProcess } from '../../types'
import {
  RiArrowRightSLine,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import {
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

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

  useEffect(() => {
    setCollapse(!expand)
  }, [expand])

  if (readonly)
    return null

  return (
    <div
      className={cn(
        '-mx-1 rounded-xl px-2.5',
        collapse ? 'border-l-[0.25px] border-components-panel-border py-[7px]' : 'border-[0.5px] border-components-panel-border-subtle px-1 pb-1 pt-[7px]',
        running && !collapse && 'bg-background-section-burn',
        succeeded && !collapse && 'bg-state-success-hover',
        failed && !collapse && 'bg-state-destructive-hover',
        collapse && 'bg-workflow-process-bg',
      )}
    >
      <div
        className={cn('flex cursor-pointer items-center', !collapse && 'px-1.5')}
        onClick={() => setCollapse(!collapse)}
      >
        {
          running && (
            <RiLoader2Line className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin text-text-tertiary" />
          )
        }
        {
          succeeded && (
            <CheckCircle className="mr-1 h-3.5 w-3.5 shrink-0 text-text-success" />
          )
        }
        {
          failed && (
            <RiErrorWarningFill className="mr-1 h-3.5 w-3.5 shrink-0 text-text-destructive" />
          )
        }
        <div className={cn('system-xs-medium text-text-secondary', !collapse && 'grow')}>
          {t('common.workflowProcess', { ns: 'workflow' })}
        </div>
        <RiArrowRightSLine className={cn('ml-1 h-4 w-4 text-text-tertiary', !collapse && 'rotate-90')} />
      </div>
      {
        !collapse && (
          <div className="mt-1.5">
            <TracingPanel
              list={data.tracing}
              hideNodeInfo={hideInfo}
              hideNodeProcessDetail={hideProcessDetail}
            />
          </div>
        )
      }
    </div>
  )
}

export default WorkflowProcessItem
