import {
  memo,
  useMemo,
} from 'react'
import type { PanelProps } from '@/app/components/workflow/panel'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import dynamic from 'next/dynamic'

const Record = dynamic(() => import('@/app/components/workflow/panel/record'), {
  ssr: false,
})
const TestRunPanel = dynamic(() => import('@/app/components/rag-pipeline/components/panel/test-run'), {
  ssr: false,
})
const InputFieldPanel = dynamic(() => import('./input-field'), {
  ssr: false,
})
const InputFieldEditorPanel = dynamic(() => import('./input-field/editor'), {
  ssr: false,
})
const PreviewPanel = dynamic(() => import('./input-field/preview'), {
  ssr: false,
})

const RagPipelinePanelOnRight = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  return (
    <>
      {historyWorkflowData && <Record />}
      {showDebugAndPreviewPanel && <TestRunPanel />}
    </>
  )
}

const RagPipelinePanelOnLeft = () => {
  const showInputFieldPanel = useStore(s => s.showInputFieldPanel)
  const showInputFieldPreviewPanel = useStore(s => s.showInputFieldPreviewPanel)
  const inputFieldEditPanelProps = useStore(s => s.inputFieldEditPanelProps)
  return (
    <>
      {showInputFieldPreviewPanel && <PreviewPanel />}
      {inputFieldEditPanelProps && (
        <InputFieldEditorPanel
          {...inputFieldEditPanelProps}
        />
      )}
      {showInputFieldPanel && <InputFieldPanel />}
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
        left: <RagPipelinePanelOnLeft />,
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
