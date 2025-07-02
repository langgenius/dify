import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { HeaderProps } from '@/app/components/workflow/header'
import Header from '@/app/components/workflow/header'
import { fetchWorkflowRunHistory } from '@/service/workflow'
import {
  useStore,
  useWorkflowStore,
} from '@/app/components/workflow/store'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'

const RagPipelineHeader = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const pipelineId = useStore(s => s.pipelineId)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)

  const viewHistoryProps = useMemo(() => {
    return {
      historyUrl: `/rag/pipelines/${pipelineId}/workflow-runs`,
      historyFetcher: fetchWorkflowRunHistory,
    }
  }, [pipelineId])

  const handleStopRun = useCallback(() => {
    const { setShowDebugAndPreviewPanel } = workflowStore.getState()
    setShowDebugAndPreviewPanel(false)
  }, [workflowStore])

  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          left: <InputFieldButton />,
          middle: <Publisher />,
        },
        runAndHistoryProps: {
          showRunButton: true,
          runButtonText: t('workflow.singleRun.testRun'),
          viewHistoryProps,
          isRunning: showDebugAndPreviewPanel,
          onStopRun: handleStopRun,
        },
      },
      viewHistory: {
        viewHistoryProps,
      },
    }
  }, [viewHistoryProps, showDebugAndPreviewPanel, handleStopRun, t])

  return (
    <Header {...headerProps} />
  )
}

export default memo(RagPipelineHeader)
