import type { HeaderProps } from '@/app/components/workflow/header'
import {
  memo,
  useMemo,
} from 'react'
import Header from '@/app/components/workflow/header'
import {
  useStore,
} from '@/app/components/workflow/store'
import InputFieldButton from './input-field-button'
import Publisher from './publisher'
import RunMode from './run-mode'

const RagPipelineHeader = () => {
  const pipelineId = useStore(s => s.pipelineId)

  const viewHistoryProps = useMemo(() => {
    return {
      historyUrl: `/rag/pipelines/${pipelineId}/workflow-runs`,
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
  }, [viewHistoryProps])

  return (
    <Header {...headerProps} />
  )
}

export default memo(RagPipelineHeader)
