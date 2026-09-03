import type { PanelProps } from '@/app/components/workflow/panel'
import { render, screen } from '@testing-library/react'
import RagPipelinePanel from '../index'

const { dynamicComponent } = vi.hoisted(() => {
  const labels = [
    'Record panel',
    'Test run panel',
    'Input field panel',
    'Input field editor panel',
    'Preview panel',
    'Global variable panel',
  ]
  let index = 0

  return {
    dynamicComponent: () => {
      const label = labels[index++]
      return () => <div>{label}</div>
    },
  }
})

vi.mock('@/next/dynamic', () => ({
  default: () => dynamicComponent(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      historyWorkflowData: { id: 'history-1' },
      showDebugAndPreviewPanel: true,
      showGlobalVariablePanel: true,
      showInputFieldPanel: true,
      showInputFieldPreviewPanel: true,
      inputFieldEditPanelProps: { nodeId: 'node-1' },
      pipelineId: 'pipeline-1',
    }),
}))

let panelProps: PanelProps | undefined

vi.mock('@/app/components/workflow/panel', () => ({
  default: (props: PanelProps) => {
    panelProps = props
    return (
      <>
        {props.components?.left}
        {props.components?.right}
      </>
    )
  },
}))

describe('RagPipelinePanel', () => {
  it('renders enabled panels and supplies pipeline version endpoints', () => {
    render(<RagPipelinePanel />)

    expect(screen.getByText('Record panel')).toBeInTheDocument()
    expect(screen.getByText('Test run panel')).toBeInTheDocument()
    expect(screen.getByText('Input field panel')).toBeInTheDocument()
    expect(screen.getByText('Input field editor panel')).toBeInTheDocument()
    expect(screen.getByText('Preview panel')).toBeInTheDocument()
    expect(screen.getByText('Global variable panel')).toBeInTheDocument()

    expect(panelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
      '/rag/pipelines/pipeline-1/workflows',
    )
    expect(panelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')).toBe(
      '/rag/pipelines/pipeline-1/workflows/version-1',
    )
    expect(panelProps?.versionHistoryPanelProps?.restoreVersionUrl?.('version-1')).toBe(
      '/rag/pipelines/pipeline-1/workflows/version-1/restore',
    )
  })
})
