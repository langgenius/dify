import type { PanelProps } from '../index'
import { screen } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import Panel from '../index'

const mockVersionHistoryPanel = vi.hoisted(() => vi.fn())

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()

  constructor(_callback: ResizeObserverCallback) {}
}

vi.mock('@/next/dynamic', () => ({
  default: () => (props: { latestVersionId?: string }) => {
    mockVersionHistoryPanel(props)
    return <div data-testid="version-history-panel">{props.latestVersionId}</div>
  },
}))

vi.mock('reactflow', async () => {
  const mod = await import('../../__tests__/reactflow-mock-state')
  const base = mod.createReactFlowModuleMock()

  return {
    ...base,
    useStore: vi.fn(selector => selector({
      getNodes: () => mod.rfState.nodes,
    })),
  }
})

vi.mock('../env-panel', () => ({
  default: () => <div data-testid="env-panel" />,
}))

vi.mock('../../nodes', () => ({
  Panel: ({ id }: { id: string }) => <div data-testid="node-panel">{id}</div>,
}))

const versionHistoryPanelProps = {
  latestVersionId: 'version-1',
  restoreVersionUrl: (versionId: string) => `/workflows/${versionId}/restore`,
} satisfies NonNullable<PanelProps['versionHistoryPanelProps']>

describe('Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetReactFlowMockState()
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Version History Panel', () => {
    it('should render the version history panel when the panel is open and props are provided', () => {
      renderWorkflowComponent(
        <Panel versionHistoryPanelProps={versionHistoryPanelProps} />,
        {
          initialStoreState: {
            showWorkflowVersionHistoryPanel: true,
          },
        },
      )

      expect(screen.getByTestId('version-history-panel')).toHaveTextContent('version-1')
      expect(mockVersionHistoryPanel).toHaveBeenCalledWith(expect.objectContaining({
        latestVersionId: 'version-1',
      }))
    })

    it('should not render the version history panel when the panel is open but props are missing', () => {
      renderWorkflowComponent(
        <Panel />,
        {
          initialStoreState: {
            showWorkflowVersionHistoryPanel: true,
          },
        },
      )

      expect(screen.queryByTestId('version-history-panel')).not.toBeInTheDocument()
      expect(mockVersionHistoryPanel).not.toHaveBeenCalled()
    })

    it('should not render the version history panel when the panel is closed', () => {
      rfState.nodes = [
        createNode({
          id: 'selected-node',
          data: {
            selected: true,
          },
        }),
      ] as typeof rfState.nodes

      renderWorkflowComponent(
        <Panel versionHistoryPanelProps={versionHistoryPanelProps} />,
        {
          initialStoreState: {
            showWorkflowVersionHistoryPanel: false,
          },
        },
      )

      expect(screen.queryByTestId('version-history-panel')).not.toBeInTheDocument()
      expect(screen.getByTestId('node-panel')).toHaveTextContent('selected-node')
    })
  })
})
