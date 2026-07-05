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
  const fallbackTitle = t('common.workflowProcess', { ns: 'workflow' })
  const statusLabel = running
    ? t('common.workflowProcessRunning', { ns: 'workflow' })
    : succeeded
      ? t('common.workflowProcessSucceeded', { ns: 'workflow' })
      : failed
        ? t('common.workflowProcessFailed', { ns: 'workflow' })
        : paused
          ? t('common.workflowProcessPaused', { ns: 'workflow' })
          : fallbackTitle
  const hasTracing = data.tracing.length > 0
  const collapsedTitle = failed
    ? (hasTracing
        ? (latestNode?.error || latestNode?.title || fallbackTitle)
        : (data.error || latestNode?.error || latestNode?.title || fallbackTitle))
    : latestNode?.title || fallbackTitle
  const showCollapsedWorkflowError = collapse && failed && !!data.error && !hasTracing

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
        collapse && failed && 'bg-[var(--color-workflow-process-failed-bg)]',
      )}
      data-testid="workflow-process-item"
    >
      <button
        type="button"
        className={cn('flex w-full cursor-pointer items-center border-0 bg-transparent p-0 text-left', !collapse && 'px-1.5')}
        aria-expanded={!collapse}
        onClick={() => setCollapse(!collapse)}
      >
        {
          running && (
            <span
              role="img"
              aria-label={statusLabel}
              className="mr-1 i-ri-loader-2-line size-3.5 shrink-0 animate-spin text-text-tertiary"
            />
          )
        }
        {
          succeeded && (
            <span
              role="img"
              aria-label={statusLabel}
              className="mr-1 i-custom-vender-solid-general-check-circle size-3.5 shrink-0 text-text-success"
            />
          )
        }
        {
          failed && (
            <span
              role="img"
              aria-label={statusLabel}
              className="mr-1 i-ri-error-warning-fill size-3.5 shrink-0 text-text-destructive"
            />
          )
        }
        {
          paused && (
            <span
              role="img"
              aria-label={statusLabel}
              className="mr-1 i-ri-pause-circle-fill size-3.5 shrink-0 text-text-warning-secondary"
            />
          )
        }
        <div
          data-testid="workflow-process-title"
          className={cn(
            'min-w-0 grow truncate system-xs-medium',
            showCollapsedWorkflowError ? 'text-text-destructive' : 'text-text-secondary',
          )}
        >
          {!collapse ? fallbackTitle : collapsedTitle}
        </div>
        <span aria-hidden className={cn('ml-1 i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary', !collapse && 'rotate-90')} />
      </button>
      {
        !collapse && (
          <div className="mt-1.5">
            {
              failed && data.error && (
                <div
                  className="mb-1.5 rounded-lg border-[0.5px] border-state-destructive-border bg-state-destructive-hover px-2 py-1.5 system-xs-regular break-words whitespace-pre-wrap text-text-destructive"
                  data-testid="workflow-process-error"
                >
                  {data.error}
                </div>
              )
            }
            {
              data.tracing.length > 0 && (
                <TracingPanel
                  list={data.tracing}
                  hideNodeInfo={hideInfo}
                  hideNodeProcessDetail={hideProcessDetail}
                />
              )
            }
          </div>
        )
      }
    </div>
  )
}

export default WorkflowProcessItem
