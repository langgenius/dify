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
  const pipelineId = useStore(s => s.pipelineId)
  const versionHistoryPanelProps = useMemo(() => {
    return {
      getVersionListUrl: `/rag/pipelines/${pipelineId}/workflows`,
      deleteVersionUrl: (versionId: string) => `/rag/pipelines/${pipelineId}/workflows/${versionId}`,
      updateVersionUrl: (versionId: string) => `/rag/pipelines/${pipelineId}/workflows/${versionId}`,
      latestVersionId: '',
    }
  }, [pipelineId])

  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: null,
        right: <RagPipelinePanelOnRight />,
      },
      versionHistoryPanelProps,
    }
  }, [versionHistoryPanelProps])

  return (
    <Panel {...panelProps} />
  )
}

export default memo(RagPipelinePanel)
