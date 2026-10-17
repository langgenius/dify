import type { ComponentType } from 'react'
import type { PanelProps } from '@/app/components/workflow/panel'
import { screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import RagPipelinePanel from '../index'

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType }>) => {
    const Component = lazy(loader)
    return () => (
      <Suspense>
        <Component />
      </Suspense>
    )
  },
}))
vi.mock('@/app/components/workflow/panel/record', () => ({
  default: () => <div>Record panel</div>,
}))
vi.mock('../test-run', () => ({ default: () => <div>Test run panel</div> }))
vi.mock('../input-field', () => ({ default: () => <div>Input field panel</div> }))
vi.mock('../input-field/editor', () => ({ default: () => <div>Input field editor panel</div> }))
vi.mock('../input-field/preview', () => ({ default: () => <div>Preview panel</div> }))
vi.mock('@/app/components/workflow/panel/global-variable-panel', () => ({
  default: () => <div>Global variable panel</div>,
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
  it('renders enabled panels and supplies pipeline version endpoints', async () => {
    render(<RagPipelinePanel />, {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    })

    expect(await screen.findByText('Record panel')).toBeInTheDocument()
    expect(await screen.findByText('Test run panel')).toBeInTheDocument()
    expect(await screen.findByText('Input field panel')).toBeInTheDocument()
    expect(await screen.findByText('Input field editor panel')).toBeInTheDocument()
    expect(await screen.findByText('Preview panel')).toBeInTheDocument()
    expect(await screen.findByText('Global variable panel')).toBeInTheDocument()

    expect(panelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe(
      '/rag/pipelines/pipeline-1/workflows',
    )
    expect(panelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')).toBe(
      '/rag/pipelines/pipeline-1/workflows/version-1',
    )
  })
})
