import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiPlayLargeLine,
} from '@remixicon/react'
import {
  useNodesReadOnly,
  useWorkflowStartRun,
} from '../hooks'
import type { ViewHistoryProps } from './view-history'
import ViewHistory from './view-history'
import Checklist from './checklist'
import cn from '@/utils/classnames'
import RunMode from './run-mode'

const PreviewMode = memo(() => {
  const { t } = useTranslation()
  const { handleWorkflowStartRunInChatflow } = useWorkflowStartRun()

  return (
    <div
      className={cn(
        'flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text',
        'cursor-pointer hover:bg-state-accent-hover',
      )}
      onClick={() => handleWorkflowStartRunInChatflow()}
    >
      <RiPlayLargeLine className='mr-1 h-4 w-4' />
      {t('workflow.common.debugAndPreview')}
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
  const { RunMode: CustomRunMode } = components || {}

  return (
    <div className='flex h-8 items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-0.5 shadow-xs'>
      {
        showRunButton && (
          CustomRunMode ? <CustomRunMode text={runButtonText} /> : <RunMode text={runButtonText} />
        )
      }
      {
        showPreviewButton && <PreviewMode />
      }
      <div className='mx-0.5 h-3.5 w-[1px] bg-divider-regular'></div>
      <ViewHistory {...viewHistoryProps} />
      <Checklist disabled={nodesReadOnly} />
    </div>
  )
}

export default memo(RunAndHistory)
