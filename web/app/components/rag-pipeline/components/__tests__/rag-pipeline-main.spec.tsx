import type { PropsWithChildren } from 'react'
import type { Edge, Node, Viewport } from 'reactflow'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RagPipelineMain from '../rag-pipeline-main'

vi.mock('../../hooks', () => ({
  useAvailableNodesMetaData: () => ({ nodes: [], nodesMap: {} }),
  useDSL: () => ({
    exportCheck: vi.fn(),
    handleExportDSL: vi.fn(),
  }),
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: vi.fn(),
  }),
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
  usePipelineRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
  usePipelineRun: () => ({
    handleBackupDraft: vi.fn(),
    handleLoadBackupDraft: vi.fn(),
    handleRestoreFromPublishedWorkflow: vi.fn(),
    handleRun: vi.fn(),
    handleStopRun: vi.fn(),
  }),
  usePipelineStartRun: () => ({
    handleStartWorkflowRun: vi.fn(),
    handleWorkflowStartRunInWorkflow: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-configs-map', () => ({
  useConfigsMap: () => ({
    flowId: 'test-flow-id',
    flowType: 'ragPipeline',
    fileSettings: {},
  }),
}))

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  useInspectVarsCrud: () => ({
    hasNodeInspectVars: vi.fn(),
    hasSetInspectVar: vi.fn(),
    fetchInspectVarValue: vi.fn(),
    editInspectVarValue: vi.fn(),
    renameInspectVarName: vi.fn(),
    appendNodeInspectVars: vi.fn(),
    deleteInspectVar: vi.fn(),
    deleteNodeInspectorVars: vi.fn(),
    deleteAllInspectorVars: vi.fn(),
    isInspectVarEdited: vi.fn(),
    resetToLastRunVar: vi.fn(),
    invalidateSysVarValues: vi.fn(),
    resetConversationVar: vi.fn(),
    invalidateConversationVarValues: vi.fn(),
  }),
}))

const mockSetRagPipelineVariables = vi.fn()
const mockSetEnvironmentVariables = vi.fn()
vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setRagPipelineVariables: mockSetRagPipelineVariables,
      setEnvironmentVariables: mockSetEnvironmentVariables,
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: () => ({
    fetchInspectVars: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({ children, onWorkflowDataUpdate }: PropsWithChildren<{ onWorkflowDataUpdate?: (payload: unknown) => void }>) => (
    <div data-testid="workflow-inner-context">
      {children}
      <button
        data-testid="trigger-update"
        onClick={() => onWorkflowDataUpdate?.({
          rag_pipeline_variables: [{ id: '1', name: 'var1' }],
          environment_variables: [{ id: '2', name: 'env1' }],
        })}
      >
        Trigger Update
      </button>
      <button
        data-testid="trigger-update-partial"
        onClick={() => onWorkflowDataUpdate?.({
          rag_pipeline_variables: [{ id: '3', name: 'var2' }],
        })}
      >
        Trigger Partial Update
      </button>
    </div>
  ),
}))

vi.mock('../rag-pipeline-children', () => ({
  default: () => <div data-testid="rag-pipeline-children">Children</div>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RagPipelineMain', () => {
  const defaultProps = {
    nodes: [] as Node[],
    edges: [] as Edge[],
    viewport: { x: 0, y: 0, zoom: 1 } as Viewport,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render without crashing', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should render RagPipelineChildren', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('rag-pipeline-children')).toBeInTheDocument()
    })

    it('should pass nodes to WorkflowWithInnerContext', () => {
      const nodes = [{ id: 'node-1', type: 'custom', position: { x: 0, y: 0 }, data: {} }] as Node[]

      render(<RagPipelineMain {...defaultProps} nodes={nodes} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should pass edges to WorkflowWithInnerContext', () => {
      const edges = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }] as Edge[]

      render(<RagPipelineMain {...defaultProps} edges={edges} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should pass viewport to WorkflowWithInnerContext', () => {
      const viewport = { x: 100, y: 200, zoom: 1.5 }

      render(<RagPipelineMain {...defaultProps} viewport={viewport} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })
  })

  describe('handleWorkflowDataUpdate callback', () => {
    it('should update rag_pipeline_variables when provided', () => {
      render(<RagPipelineMain {...defaultProps} />)

      const button = screen.getByTestId('trigger-update')
      button.click()

      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([{ id: '1', name: 'var1' }])
    })

    it('should update environment_variables when provided', () => {
      render(<RagPipelineMain {...defaultProps} />)

      const button = screen.getByTestId('trigger-update')
      button.click()

      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([{ id: '2', name: 'env1' }])
    })

    it('should only update rag_pipeline_variables when environment_variables is not provided', () => {
      render(<RagPipelineMain {...defaultProps} />)

      const button = screen.getByTestId('trigger-update-partial')
      button.click()

      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([{ id: '3', name: 'var2' }])
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
    })
  })

  describe('hooks integration', () => {
    it('should use useNodesSyncDraft hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use usePipelineRefreshDraft hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use usePipelineRun hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use usePipelineStartRun hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use useAvailableNodesMetaData hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use useGetRunAndTraceUrl hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use useDSL hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use useConfigsMap hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should use useInspectVarsCrud hook', () => {
      render(<RagPipelineMain {...defaultProps} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('should handle empty nodes array', () => {
      render(<RagPipelineMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should handle empty edges array', () => {
      render(<RagPipelineMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })

    it('should handle default viewport', () => {
      render(<RagPipelineMain nodes={[]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />)

      expect(screen.getByTestId('workflow-inner-context')).toBeInTheDocument()
    })
  })
})
