import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { HeaderProps } from '@/app/components/workflow/header'
import Header from '@/app/components/workflow/header'
import { fetchWorkflowRunHistory } from '@/service/workflow'
import {
  useStore,
} from '@/app/components/workflow/store'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'
import RunMode from './run-mode'

const RagPipelineHeader = () => {
  const { t } = useTranslation()
  const pipelineId = useStore(s => s.pipelineId)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)

  const viewHistoryProps = useMemo(() => {
    return {
      historyUrl: `/rag/pipelines/${pipelineId}/workflow-runs`,
      historyFetcher: fetchWorkflowRunHistory,
    }
  }, [pipelineId])

  const headerProps: HeaderProps = useMemo(() => {
    return {
      normal: {
        components: {
          left: <InputFieldButton />,
          middle: <Publisher />,
        },
        runAndHistoryProps: {
          showRunButton: true,
          viewHistoryProps,
          components: {
            RunMode,
          },
        },
      },
      viewHistory: {
        viewHistoryProps,
      },
    }
  }, [viewHistoryProps, showDebugAndPreviewPanel, t])

  return (
    <Header {...headerProps} />
  )
}

export default memo(RagPipelineHeader)
