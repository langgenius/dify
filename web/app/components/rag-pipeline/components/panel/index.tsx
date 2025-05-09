import {
  memo,
  useMemo,
} from 'react'
import type { PanelProps } from '@/app/components/workflow/panel'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import Record from '@/app/components/workflow/panel/record'
import TestRunPanel from './test-run'

const RagPipelinePanelOnRight = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  return (
    <>
      {
        historyWorkflowData && (
          <Record />
        )
      }
      {showDebugAndPreviewPanel && <TestRunPanel />}
    </>
  )
}

const RagPipelinePanel = () => {
  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: null,
        right: <RagPipelinePanelOnRight />,
      },
    }
  }, [])

  return (
    <Panel {...panelProps} />
  )
}

export default memo(RagPipelinePanel)
