import type { PropsWithChildren } from 'react'
import type { Edge, Node, Viewport } from 'reactflow'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import { DatasetACLPermission } from '@/utils/permission'
import RagPipelineMain from '../rag-pipeline-main'

const mockPermissionState = vi.hoisted(() => ({
  permissionKeys: ['dataset.acl.edit'] as string[],
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('../../hooks/use-available-nodes-meta-data', () => ({
  useAvailableNodesMetaData: () => ({ nodes: [], nodesMap: {} }),
}))

vi.mock('../../hooks/use-DSL', () => ({
  useDSLByCanEdit: () => ({
    exportCheck: vi.fn(),
    handleExportDSL: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-get-run-and-trace-url', () => ({
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
  useNodesSyncDraftByCanEdit: () => ({
    doSyncWorkflowDraft: vi.fn(),
    syncWorkflowDraftWhenPageClose: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-pipeline-refresh-draft', () => ({
  usePipelineRefreshDraft: () => ({
    handleRefreshWorkflowDraft: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-pipeline-run', () => ({
  usePipelineRunByCanEdit: () => ({
    handleBackupDraft: vi.fn(),
    handleLoadBackupDraft: vi.fn(),
    handleRestoreFromPublishedWorkflow: vi.fn(),
    handleRun: vi.fn(),
    handleStopRun: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-pipeline-start-run', () => ({
  usePipelineStartRunByCanEdit: () => ({
    handleStartWorkflowRun: vi.fn(),
    handleWorkflowStartRunInWorkflow: vi.fn(),
  }),
}))

vi.mock('../../hooks/use-file-settings', () => ({ useFileSettings: () => ({ enabled: true }) }))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: () => ({
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

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { permission_keys: string[] } }) => unknown,
  ) => selector({ dataset: { permission_keys: mockPermissionState.permissionKeys } }),
}))

let workflowProps: Record<string, unknown>
vi.mock('@/app/components/workflow', () => ({
  WorkflowWithInnerContext: ({
    children,
    onWorkflowDataUpdate,
    hooksStore,
    ...graphProps
  }: PropsWithChildren<{
    onWorkflowDataUpdate?: (payload: unknown) => void
    hooksStore?: { accessControl?: { canEdit?: boolean } }
    nodes?: Node[]
    edges?: Edge[]
    viewport?: Viewport
  }>) => {
    workflowProps = { ...graphProps, hooksStore }
    return (
      <div data-testid="workflow-inner-context">
        <div data-testid="can-edit">{String(hooksStore?.accessControl?.canEdit)}</div>
        {children}
        <button
          data-testid="trigger-update"
          onClick={() =>
            onWorkflowDataUpdate?.({
              rag_pipeline_variables: [{ id: '1', name: 'var1' }],
              environment_variables: [{ id: '2', name: 'env1' }],
            })
          }
        >
          Trigger Update
        </button>
        <button
          data-testid="trigger-update-partial"
          onClick={() =>
            onWorkflowDataUpdate?.({
              rag_pipeline_variables: [{ id: '3', name: 'var2' }],
            })
          }
        >
          Trigger Partial Update
        </button>
      </div>
    )
  },
}))

vi.mock('../rag-pipeline-children', () => ({
  default: () => <div data-testid="rag-pipeline-children">Children</div>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('RagPipelineMain', () => {
  const defaultProps = {
    nodes: [] as Node[],
    edges: [] as Edge[],
    viewport: { x: 0, y: 0, zoom: 1 } as Viewport,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissionState.permissionKeys = [DatasetACLPermission.Edit]
  })

  it.each([DatasetACLPermission.Edit, DatasetACLPermission.Readonly])(
    'passes the graph and edit capability for %s',
    (permission) => {
      mockPermissionState.permissionKeys = [permission]
      const nodes = [createNode({ id: 'node-1' })]
      const edges = [{ id: 'edge-1', source: 'node-1', target: 'node-2' }]
      const viewport = { x: 100, y: 200, zoom: 1.5 }
      render(<RagPipelineMain nodes={nodes} edges={edges} viewport={viewport} />)
      expect(workflowProps).toMatchObject({
        nodes,
        edges,
        viewport,
        hooksStore: { accessControl: { canEdit: permission === DatasetACLPermission.Edit } },
      })
    },
  )

  describe('handleWorkflowDataUpdate callback', () => {
    it('should update rag_pipeline_variables when provided', async () => {
      render(<RagPipelineMain {...defaultProps} />)

      const button = screen.getByTestId('trigger-update')
      await userEvent.setup().click(button)

      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([{ id: '1', name: 'var1' }])
      expect(mockSetEnvironmentVariables).toHaveBeenCalledWith([{ id: '2', name: 'env1' }])
    })

    it('should only update rag_pipeline_variables when environment_variables is not provided', async () => {
      render(<RagPipelineMain {...defaultProps} />)

      const button = screen.getByTestId('trigger-update-partial')
      await userEvent.setup().click(button)

      expect(mockSetRagPipelineVariables).toHaveBeenCalledWith([{ id: '3', name: 'var2' }])
      expect(mockSetEnvironmentVariables).not.toHaveBeenCalled()
    })
  })
})
