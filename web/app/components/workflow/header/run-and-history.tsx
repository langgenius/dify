import type { ViewHistoryProps } from './view-history'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiPlayLargeLine,
} from '@remixicon/react'
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

const PreviewMode = memo(() => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInChatflow } = useWorkflowStartRun()
  const canRun = useHooksStore(s => s.accessControl.canRun)

  if (!canRun)
    return null

  return (
    <div
      className={cn(
        'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
        'cursor-pointer hover:bg-state-accent-hover',
      )}
      onClick={() => handleWorkflowStartRunInChatflow()}
    >
      <RiPlayLargeLine className="mr-1 h-4 w-4" />
      {t('common.debugAndPreview', { ns: 'workflow' })}
    </div>
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
        showRunButton && canRun && (
          CustomRunMode ? <CustomRunMode text={runButtonText} /> : <RunMode text={runButtonText} />
        )
      }
      {
        showPreviewButton && canRun && <PreviewMode />
      }
      <div className="mx-0.5 h-3.5 w-px bg-divider-regular"></div>
      <ViewHistory {...viewHistoryProps} />
      <Checklist disabled={nodesReadOnly} />
    </div>
  )
}

export default memo(RunAndHistory)
