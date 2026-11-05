import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowInitializationProbe } from '@/app/components/workflow/__tests__/workflow-initialization-probe'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { useTriggerStatusStore } from '@/app/components/workflow/store/trigger-status'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { seedAppDetail, seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { AppACLPermission } from '@/utils/permission'
import WorkflowApp from '../index'

const mockFetchRunDetail = vi.fn()
let workflowStore: ReturnType<typeof useWorkflowStore>

let appDetail: AppDetailWithSite

const fetchDraft = vi.fn()
const fetchFeatures = vi.fn()

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

const render = (
  ui: ReactElement,
  options?: {
    cloud?: boolean
    plan?: 'sandbox' | 'professional' | 'team'
    collaboration?: boolean | null
  },
) => {
  const queryClient = createAccountProfileQueryClient(consoleState.userProfile)
  seedSystemFeatures(queryClient, options?.cloud ? { deployment_edition: 'CLOUD' } : {})
  if (options?.collaboration !== null)
    seedFeatures(queryClient, {
      workflow_collaboration_enabled: options?.collaboration ?? true,
      ...(options?.plan ? { billing: { subscription: { plan: options.plan } } } : {}),
    })
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
  return {
    ...renderWithConsoleState(ui, { wrapper: createQueryClientWrapper(queryClient) }),
    queryClient,
  }
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

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (...args: unknown[]) => fetchDraft(...args),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'features.get': () => fetchFeatures(),
      'files.upload.get': () => createFileUploadConfigFixture(),
      'apps.byAppId.workflows.defaultWorkflowBlockConfigs.get': () => [],
      'apps.byAppId.workflows.publish.get': () => createWorkflowResponseFixture(),
    }),
  }
})

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => mockFetchRunDetail(...args),
}))

vi.mock('@/app/components/workflow-app/components/workflow-main', () => ({
  // Full editor interactions have their own suites; this probe observes the real initialized store.
  default: function WorkflowMainProbe({
    viewport,
  }: {
    viewport: { x: number; y: number; zoom: number }
  }) {
    workflowStore = useWorkflowStore()
    return (
      <section aria-label="Workflow canvas">
        <WorkflowInitializationProbe />
        <output aria-label="Saved viewport">{JSON.stringify(viewport)}</output>
        <output aria-label="Collaboration enabled">
          {String(useStore((state) => state.isCollaborationEnabled))}
        </output>
      </section>
    )
  },
}))

describe('WorkflowApp', () => {
  beforeEach(() => {
    appDetail = createAppDetailFixture({
      id: 'app-1',
      mode: 'workflow' as const,
      permission_keys: [AppACLPermission.TestAndRun],
    })
    fetchDraft.mockResolvedValue(
      createWorkflowResponseFixture({
        hash: 'loaded-draft',
        graph: {
          nodes: [
            createNode({ id: 'raw-node', data: { type: BlockEnum.Start, variables: [] } }),
            createNode({ id: 'end-node', data: { type: BlockEnum.End, outputs: [] } }),
          ],
          edges: [
            createEdge({
              id: 'raw-edge',
              source: 'raw-node',
              target: 'end-node',
              data: { targetType: BlockEnum.End },
            }),
          ],
          viewport: { x: 1, y: 2, zoom: 1.5 },
        },
        features: { file_upload: { enabled: true } },
      }),
    )
    consoleState = {
      isLoadingCurrentWorkspace: false,
      currentWorkspace: { id: 'workspace-1' },
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
    appTriggersState = {}
    searchParamsValue = null
    fetchFeatures.mockReset()
    mockFetchRunDetail.mockReset().mockResolvedValue({ inputs: null })
  })

  it.each([
    ['sandbox', 'false'],
    ['professional', 'true'],
    ['team', 'true'],
  ] as const)('initializes a Cloud %s workspace with collaboration %s', async (plan, expected) => {
    render(<WorkflowApp />, { cloud: true, plan, collaboration: expected === 'true' })
    expect(await screen.findByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    expect(screen.getByLabelText('Collaboration enabled')).toHaveTextContent(expected)
  })

  it.each([false, true])(
    'keeps the initial editor mode when workspace capability changes from %s',
    async (initial) => {
      const { queryClient } = render(<WorkflowApp />, { cloud: true, collaboration: initial })
      expect(await screen.findByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
      act(() => seedFeatures(queryClient, { workflow_collaboration_enabled: !initial }))
      expect(screen.getByLabelText('Collaboration enabled')).toHaveTextContent(String(initial))
    },
  )

  it('waits for the Cloud subscription before starting the editor', async () => {
    let resolveFeatures!: (features: ReturnType<typeof zGetFeaturesResponse.parse>) => void
    fetchFeatures.mockReturnValue(
      new Promise((resolve) => {
        resolveFeatures = resolve
      }),
    )
    fetchDraft.mockClear()

    render(<WorkflowApp />, { cloud: true, collaboration: null })
    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Workflow canvas' })).not.toBeInTheDocument()
    expect(fetchDraft).not.toHaveBeenCalled()

    await act(async () =>
      resolveFeatures(zGetFeaturesResponse.parse({ workflow_collaboration_enabled: false })),
    )
    expect(await screen.findByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    expect(screen.getByLabelText('Collaboration enabled')).toHaveTextContent('false')
  })

  it('blocks the editor when the subscription cannot be loaded and retries in place', async () => {
    const user = userEvent.setup()
    fetchFeatures
      .mockRejectedValueOnce(new Error('billing unavailable'))
      .mockResolvedValueOnce(zGetFeaturesResponse.parse({ workflow_collaboration_enabled: true }))

    render(<WorkflowApp />, { cloud: true, collaboration: null })
    const retry = await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' })
    expect(screen.getByRole('alert')).toHaveTextContent('common.errorBoundary.message')
    expect(screen.queryByRole('region', { name: 'Workflow canvas' })).not.toBeInTheDocument()

    await user.click(retry)
    expect(await screen.findByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    expect(screen.getByLabelText('Collaboration enabled')).toHaveTextContent('true')
    expect(fetchFeatures).toHaveBeenCalledTimes(2)
  })

  it('keeps the canvas gated until the workflow draft arrives', async () => {
    let resolveDraft!: (value: ReturnType<typeof createWorkflowResponseFixture>) => void
    fetchDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDraft = resolve
      }),
    )
    render(<WorkflowApp />)

    expect(screen.getByLabelText('common.loading')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Workflow canvas' })).not.toBeInTheDocument()

    resolveDraft(
      createWorkflowResponseFixture({
        graph: {
          nodes: [
            createNode({ id: 'loaded-start', data: { type: BlockEnum.Start, variables: [] } }),
          ],
          edges: [],
        },
      }),
    )
    expect(await screen.findByRole('region', { name: 'Workflow canvas' })).toBeInTheDocument()
    expect(await screen.findByRole('status', { name: 'Initialized nodes' })).toHaveTextContent(
      'loaded-start:Node loaded-start',
    )
    expect(screen.queryByLabelText('common.loading')).not.toBeInTheDocument()
  })

  it('initializes the graph and trigger statuses in the real workflow providers', async () => {
    appTriggersState = {
      data: {
        data: [
          { node_id: 'trigger-enabled', status: 'enabled' },
          { node_id: 'trigger-disabled', status: 'paused' },
        ],
      },
    }

    render(
      <StrictMode>
        <WorkflowApp />
      </StrictMode>,
    )

    await screen.findByRole('region', { name: 'Workflow canvas' })
    expect(await screen.findByRole('status', { name: 'Draft hash' })).toHaveTextContent(
      'loaded-draft',
    )
    expect(await screen.findByRole('status', { name: 'Initialized nodes' })).toHaveTextContent(
      'raw-node:Node raw-node,end-node:Node end-node',
    )
    expect(await screen.findByRole('status', { name: 'Initialized edges' })).toHaveTextContent(
      'raw-node->end-node',
    )
    expect(screen.getByLabelText('Saved viewport')).toHaveTextContent(
      JSON.stringify({ x: 1, y: 2, zoom: 1.5 }),
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

    render(<WorkflowApp />)
    await screen.findByRole('region', { name: 'Workflow canvas' })

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
  })

  it('should skip replay lookups when replayRunId is missing', async () => {
    render(<WorkflowApp />)
    await screen.findByRole('region', { name: 'Workflow canvas' })

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
    await screen.findByRole('region', { name: 'Workflow canvas' })

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
    await screen.findByRole('region', { name: 'Workflow canvas' })

    await waitFor(() => {
      expect(mockFetchRunDetail).toHaveBeenCalledWith('/apps/app-1/workflow-runs/run-1')
    })

    expect(workflowStore.getState().inputs).toEqual({})
    expect(workflowStore.getState().showInputsPanel).toBe(false)
    expect(workflowStore.getState().showDebugAndPreviewPanel).toBe(false)
  })
})
