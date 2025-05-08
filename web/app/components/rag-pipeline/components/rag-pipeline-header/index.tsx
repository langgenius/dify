import {
  memo,
  useMemo,
} from 'react'
import type { HeaderProps } from '@/app/components/workflow/header'
import Header from '@/app/components/workflow/header'
import { fetchWorkflowRunHistory } from '@/service/workflow'
import { useStore } from '@/app/components/workflow/store'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'

const RagPipelineHeader = () => {
  const pipelineId = useStore(s => s.pipelineId)

  const viewHistoryProps = useMemo(() => {
    return {
      historyUrl: '',
      // historyUrl: `/rag/pipeline/${pipelineId}/workflow-runs`,
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
          runButtonText: 'Test Run',
          viewHistoryProps,
        },
      },
      viewHistory: {
        viewHistoryProps,
      },
    }
  }, [viewHistoryProps])

  return (
    <Header {...headerProps} />
  )
}

export default memo(RagPipelineHeader)
