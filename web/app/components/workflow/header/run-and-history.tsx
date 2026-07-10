import type { ViewHistoryProps } from './view-history'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useNodesReadOnly,
  useWorkflowStartRun,
} from '../hooks'
import { useHooksStore } from '../hooks-store'
import Checklist from './checklist'
import RunMode from './run-mode'
import ViewHistory from './view-history'

const PreviewMode = memo(({
  disabled = false,
}: {
  disabled?: boolean
}) => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInChatflow } = useWorkflowStartRun()
  const canRun = useHooksStore(s => s.accessControl.canRun)
  const isDisabled = disabled || !canRun

  return (
    <button
      type="button"
      disabled={isDisabled}
      className={cn(
        'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
        isDisabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-state-accent-hover',
      )}
      onClick={() => {
        if (!isDisabled)
          handleWorkflowStartRunInChatflow()
      }}
    >
      <span aria-hidden className="mr-1 i-ri-play-large-line size-4" />
      {t($ => $['common.debugAndPreview'], { ns: 'workflow' })}
    </button>
  )
})

export type RunAndHistoryProps = {
  showRunButton?: boolean
  runButtonText?: string
  isRunning?: boolean
  showPreviewButton?: boolean
  viewHistoryProps?: ViewHistoryProps
  components?: {
    RunMode?: React.ComponentType<
      {
        text?: string
        disabled?: boolean
      }
    >
  }
}
const RunAndHistory = ({
  showRunButton,
  runButtonText,
  showPreviewButton,
  viewHistoryProps,
  components,
}: RunAndHistoryProps) => {
  const { nodesReadOnly } = useNodesReadOnly()
  const canRun = useHooksStore(s => s.accessControl.canRun)
  const { RunMode: CustomRunMode } = components || {}

  return (
    <div className="flex h-8 items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-0.5 shadow-xs">
      {
        showRunButton && (
          CustomRunMode ? <CustomRunMode text={runButtonText} disabled={!canRun} /> : <RunMode text={runButtonText} disabled={!canRun} />
        )
      }
      {
        showPreviewButton && <PreviewMode disabled={!canRun} />
      }
      <div className="mx-0.5 h-3.5 w-px bg-divider-regular"></div>
      <ViewHistory {...viewHistoryProps} />
      <Checklist disabled={nodesReadOnly} />
    </div>
  )
}

export default memo(RunAndHistory)
