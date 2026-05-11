import type { ChatItem, WorkflowProcess } from '../../types'

import { cn } from '@langgenius/dify-ui/cn'
import {
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
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
  const paused = data.status === WorkflowRunningStatus.Paused
  const latestNode = data.tracing[data.tracing.length - 1]

  useEffect(() => {
    setCollapse(!expand)
  }, [expand])

  if (readonly)
    return null

  return (
    <div
      className={cn(
        '-mx-1 rounded-xl px-2.5',
        collapse ? 'border-l-[0.25px] border-components-panel-border py-[7px]' : 'border-[0.5px] border-components-panel-border-subtle px-1 pt-[7px] pb-1',
        running && !collapse && 'bg-background-section-burn',
        succeeded && !collapse && 'bg-state-success-hover',
        failed && !collapse && 'bg-state-destructive-hover',
        paused && !collapse && 'bg-state-warning-hover',
        collapse && !failed && !paused && 'bg-workflow-process-bg',
        collapse && paused && 'bg-workflow-process-paused-bg',
        collapse && failed && 'bg-workflow-process-failed-bg',
      )}
      data-testid="workflow-process-item"
    >
      <div
        className={cn('flex cursor-pointer items-center', !collapse && 'px-1.5')}
        onClick={() => setCollapse(!collapse)}
        data-testid="workflow-process-header"
      >
        {
          running && (
            <div
              className="mr-1 i-ri-loader-2-line h-3.5 w-3.5 shrink-0 animate-spin text-text-tertiary"
              data-testid="status-icon-running"
            />
          )
        }
        {
          succeeded && (
            <div
              className="mr-1 i-custom-vender-solid-general-check-circle h-3.5 w-3.5 shrink-0 text-text-success"
              data-testid="status-icon-success"
            />
          )
        }
        {
          failed && (
            <div
              className="mr-1 i-ri-error-warning-fill h-3.5 w-3.5 shrink-0 text-text-destructive"
              data-testid="status-icon-failed"
            />
          )
        }
        {
          paused && (
            <div
              className="mr-1 i-ri-pause-circle-fill h-3.5 w-3.5 shrink-0 text-text-warning-secondary"
              data-testid="status-icon-paused"
            />
          )
        }
        <div
          className="min-w-0 grow truncate system-xs-medium text-text-secondary"
          data-testid="workflow-process-title"
        >
          {!collapse ? t('common.workflowProcess', { ns: 'workflow' }) : latestNode?.title}
        </div>
        <div className={cn('ml-1 i-ri-arrow-right-s-line h-4 w-4 shrink-0 text-text-tertiary', !collapse && 'rotate-90')} />
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
