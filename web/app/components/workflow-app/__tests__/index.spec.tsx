import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement, ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { seedAppDetail } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { AppACLPermission } from '@/utils/permission'
import WorkflowApp from '../index'

const mockFetchRunDetail = vi.fn()
let workflowStore: ReturnType<typeof useWorkflowStore>

let appDetail: AppDetailWithSite

let workflowInitState: {
  data: {
    graph: {
      nodes: Array<Record<string, unknown>>
      edges: Array<Record<string, unknown>>
      viewport: { x: number; y: number; zoom: number }
    }
    features: Record<string, unknown>
  } | null
  isLoading: boolean
  fileUploadConfigResponse: Record<string, unknown> | null
}

let consoleState: {
  isLoadingCurrentWorkspace: boolean
  currentWorkspace: {
    id?: string
  }
  userProfile: {
    id: string
  }
  workspacePermissionKeys: string[]
}

let appTriggersState: {
  data?: {
    data: Array<{
      node_id: string
      status: string
    }>
  }
}

let searchParamsValue: string | null = null

const render = (ui: ReactElement) => {
  const queryClient = createAccountProfileQueryClient(consoleState.userProfile)
  seedAppDetail(queryClient, appDetail)
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.triggers.get.queryKey({
      input: { params: { app_id: appDetail.id } },
    }),
    {
      data: (appTriggersState.data?.data ?? []).map((trigger) => ({
        id: trigger.node_id,
        icon: '',
        provider_name: '',
        title: trigger.node_id,
        trigger_type: 'schedule',
        ...trigger,
      })),
    },
  )
  return renderWithConsoleState(ui, {
    wrapper: createQueryClientWrapper(queryClient),
  })
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isLoadingCurrentWorkspace: consoleState.isLoadingCurrentWorkspace,
    currentWorkspace: consoleState.currentWorkspace,
    userProfile: consoleState.userProfile,
    workspacePermissionKeys: consoleState.workspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    isLoadingCurrentWorkspace: consoleState.isLoadingCurrentWorkspace,
    currentWorkspace: consoleState.currentWorkspace,
    userProfile: consoleState.userProfile,
    workspacePermissionKeys: consoleState.workspacePermissionKeys,
  }))
})

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'replayRunId' ? searchParamsValue : null),
  }),
}))

// Draft loading has its own suite; this owner integrates ready/loading data, replay and trigger status.
vi.mock('../hooks/use-workflow-init', () => ({ useWorkflowInit: () => workflowInitState }))

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
}))

vi.mock('@/app/components/workflow', () => ({
  default: ({
    nodes,
    edges,
    children,
  }: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    children: ReactNode
  }) => (
    <div
      data-testid="workflow-default-context"
      data-nodes={JSON.stringify(nodes)}
      data-edges={JSON.stringify(edges)}
    >
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow-app/components/workflow-main', () => ({
  default: function WorkflowMainMock({
    nodes,
    edges,
    viewport,
  }: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    viewport: Record<string, unknown>
  }) {
    workflowStore = useWorkflowStore()

    return (
      <div
        role="region"
        aria-label="Workflow canvas"
        data-nodes={JSON.stringify(nodes)}
        data-edges={JSON.stringify(edges)}
        data-viewport={JSON.stringify(viewport)}
      />
    )
  },
}))

describe('WorkflowApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTriggerStatusStore.getState().clearTriggerStatuses()
    appDetail = createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow' as const,
      permission_keys: [AppACLPermission.TestAndRun],
    })
    workflowInitState = {
      data: {
        graph: {
          nodes: [
            createNode({ id: 'raw-node', data: { type: BlockEnum.Start } }),
            createNode({ id: 'end-node', data: { type: BlockEnum.End } }),
          ],
          edges: [
            createEdge({
              id: 'raw-edge',
              source: 'raw-node',
              target: 'end-node',
              data: { targetType: BlockEnum.End },
            }),
          ],
          viewport: { x: 1, y: 2, zoom: 3 },
        },
        features: {
          file_upload: {
            enabled: true,
          },
        },
      },
      isLoading: false,
      fileUploadConfigResponse: createFileUploadConfigFixture(),
    }
    consoleState = {
      isLoadingCurrentWorkspace: false,
      currentWorkspace: { id: 'workspace-1' },
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
    appTriggersState = {}
    searchParamsValue = null
    mockFetchRunDetail.mockReset().mockResolvedValue({ inputs: null })
  })

  it('should render the loading shell while workflow data is still loading', () => {
    workflowInitState = {
      data: null,
      isLoading: true,
      fileUploadConfigResponse: null,
    }

    render(<WorkflowApp />)

    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Workflow canvas' })).not.toBeInTheDocument()
  })

  it('should render the workflow app shell and sync trigger statuses when data is ready', () => {
    appTriggersState = {
      data: {
        data: [
          { node_id: 'trigger-enabled', status: 'enabled' },
          { node_id: 'trigger-disabled', status: 'paused' },
        ],
      },
    }

    render(<WorkflowApp />)

    const graphContext = screen.getByTestId('workflow-default-context')
    expect(JSON.parse(graphContext.getAttribute('data-nodes')!)).toMatchObject([
      { id: 'raw-node', data: { type: BlockEnum.Start, _connectedSourceHandleIds: ['source'] } },
      { id: 'end-node', data: { type: BlockEnum.End, _connectedTargetHandleIds: ['target'] } },
    ])
    expect(JSON.parse(graphContext.getAttribute('data-edges')!)).toMatchObject([
      {
        source: 'raw-node',
        target: 'end-node',
        data: { sourceType: BlockEnum.Start, targetType: BlockEnum.End },
      },
    ])
    expect(screen.getByRole('region', { name: 'Workflow canvas' })).toHaveAttribute(
      'data-viewport',
      JSON.stringify({ x: 1, y: 2, zoom: 3 }),
    )
    expect(useTriggerStatusStore.getState().triggerStatuses).toEqual({
      'trigger-enabled': 'enabled',
      'trigger-disabled': 'disabled',
    })
  })

  it('should replay workflow inputs from replayRunId', async () => {
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs:
        '{"sys.query":"hidden","foo":"bar","count":2,"flag":true,"obj":{"nested":true},"nil":null}',
    })

    const { unmount } = render(<WorkflowApp />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/apps/app-1/workflow-runs/run-1')
      expect(workflowStore.getState().inputs).toEqual({
        foo: 'bar',
        count: 2,
        flag: true,
        obj: '{"nested":true}',
        nil: '',
      })
      expect(workflowStore.getState().showInputsPanel).toBe(true)
      expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(true)
    })

    unmount()
  })

  it('should skip replay lookups when replayRunId is missing', () => {
    render(<WorkflowApp />)

    expect(mockFetchRunDetail).not.toHaveBeenCalled()
    expect(workflowStore.getState().inputs).toEqual({})
  })

  it('should skip replay lookups when test/run permission is missing', async () => {
    searchParamsValue = 'run-1'
    appDetail = createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow' as const,
      permission_keys: [AppACLPermission.ViewLayout],
    })

    render(<WorkflowApp />)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    })

    expect(mockFetchRunDetail).not.toHaveBeenCalled()
    expect(workflowStore.getState().inputs).toEqual({})
  })

  it('should stop replay recovery when workflow run inputs cannot be parsed', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs: '{invalid-json}',
    })

    render(<WorkflowApp />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/apps/app-1/workflow-runs/run-1')
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to parse workflow run inputs',
      expect.any(Error),
    )
    expect(workflowStore.getState().inputs).toEqual({})
    expect(workflowStore.getState().showInputsPanel).toBe(false)
    expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(false)

    consoleErrorSpy.mockRestore()
  })

  it('should ignore replay inputs when they only contain sys variables', async () => {
    searchParamsValue = 'run-1'
    mockFetchRunDetail.mockResolvedValue({
      inputs: '{"sys.query":"hidden","sys.user_id":"u-1"}',
    })

    render(<WorkflowApp />)

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/apps/app-1/workflow-runs/run-1')
    })

    expect(workflowStore.getState().inputs).toEqual({})
    expect(workflowStore.getState().showInputsPanel).toBe(false)
    expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(false)
  })
})
