import type { AppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import { act } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import toolDefault from '@/app/components/workflow/nodes/tool/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { FlowType } from '@/types/common'
import useLastRun from '../use-last-run'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockShowSingleRun = vi.fn()
const mockHandleRun = vi.fn()
const mockBuiltInTools = [
  { id: 'provider-id', name: 'provider-name', allow_delete: true, is_team_authorization: false },
]
const mockToolValidationData = {
  notAuthed: true,
  language: 'en_US',
  toolInputsSchema: [] as Array<{ required: boolean; variable: string; label: string }>,
  toolSettingSchema: [],
}

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockBuiltInTools }),
}))

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

vi.mock('@/app/components/workflow/nodes/tool/hooks/use-get-data-for-check-more', () => ({
  default: () => ({ getData: () => mockToolValidationData }),
}))

vi.mock('@/app/components/workflow/nodes/tool/hooks/use-single-run-form-params', () => ({
  default: () => ({ forms: [], getDependentVars: () => [] }),
}))

vi.mock('../../../../../../hooks/use-nodes-sync-draft', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../../hooks/use-nodes-sync-draft')>()

  return {
    ...actual,
    useNodesSyncDraft: () => ({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    }),
  }
})

vi.mock('../../../../../../hooks/use-checklist', () => ({
  useWorkflowRunValidation: () => ({
    warningNodes: [],
  }),
}))

vi.mock('../../../../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    conversationVars: [],
    systemVars: [],
    hasSetInspectVar: vi.fn(() => false),
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-one-step-run', () => ({
  default: function useOneStepRun(params: { data: ToolNodeType; moreDataForCheckValid: unknown }) {
    const { t } = useTranslation(['workflow'])
    return {
      hideSingleRun: vi.fn(),
      handleRun: mockHandleRun,
      getInputVars: vi.fn(() => []),
      toVarInputs: vi.fn(() => []),
      varSelectorsToVarInputs: vi.fn(() => []),
      runInputData: {},
      runInputDataRef: { current: {} },
      setRunInputData: vi.fn(),
      showSingleRun: mockShowSingleRun,
      runResult: {},
      iterationRunResult: [],
      loopRunResult: [],
      setNodeRunning: vi.fn(),
      checkValid: () => {
        if (params.data.type !== BlockEnum.Tool) return { isValid: true }
        const result = toolDefault.checkValid(params.data, t, params.moreDataForCheckValid)
        // Preserve the run boundary's validation feedback while keeping network execution mocked.
        if (!result.isValid && result.errorMessage) toast.error(result.errorMessage)
        return result
      },
    }
  },
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidLastRun: () => vi.fn(),
}))

describe('useLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToolValidationData.toolInputsSchema = []
    mockHandleSyncWorkflowDraft.mockImplementation(
      (_force, _immediate, options?: { onSuccess?: () => void }) => options?.onSuccess?.(),
    )
  })

  it('syncs the draft before opening a custom single-run form', () => {
    const { result } = renderWorkflowHook(() =>
      useLastRun({
        id: 'data-source-node',
        flowId: 'flow-id',
        flowType: FlowType.appFlow,
        data: {
          type: BlockEnum.DataSource,
          title: 'Data Source',
          desc: '',
        },
        defaultRunInputData: {},
        isPaused: false,
      }),
    )

    act(() => {
      result.current.handleSingleRun()
    })

    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    expect(mockShowSingleRun).toHaveBeenCalledTimes(1)
    expect(mockHandleRun).not.toHaveBeenCalled()
  })

  const toolData: ToolNodeType = {
    type: BlockEnum.Tool,
    title: 'Tool',
    desc: '',
    provider_id: 'provider-id',
    provider_name: 'provider-name',
    provider_type: CollectionType.builtIn,
    tool_name: 'search',
    tool_label: 'Search',
    tool_parameters: {},
    tool_configurations: {},
  }
  const appUserDraft: AppUserAuthDraft = {
    oauthEnabled: false,
    apiKeyEnabled: true,
    description: 'Connect app users',
    testConnection: { connections: [] },
  }
  const renderTool = (
    authorizationTab: 'workspace-auth' | 'app-user-auth' | 'reuse-from-node',
    draft = appUserDraft,
  ) =>
    renderWorkflowHook(
      () =>
        useLastRun({
          id: 'tool-node',
          flowId: 'flow-id',
          flowType: FlowType.appFlow,
          data: toolData,
          defaultRunInputData: {},
          isPaused: false,
        }),
      {
        initialStoreState: {
          nodeAuthDrafts: {
            'tool-node': {
              provider: 'provider-name',
              providerId: 'provider-id',
              authorizationTab,
              draft,
            },
          },
        },
      },
    )

  it.each([
    { mode: 'workspace-auth' as const, reason: 'workflow.panel.configureWorkspaceAuthorization' },
    { mode: 'app-user-auth' as const, reason: 'workflow.panel.configureTestRunConnection' },
    { mode: 'reuse-from-node' as const, reason: 'workflow.panel.selectReuseNode' },
  ])(
    'silently blocks direct run handlers in $mode without syncing or sending a request',
    async ({ mode, reason }) => {
      const { result } = renderTool(mode)
      expect(result.current.singleRunDisabledReason).toBe(reason)
      await act(async () => {
        result.current.handleSingleRun()
        await result.current.handleRunWithParams({ query: 'test' })
      })
      expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
      expect(mockHandleRun).not.toHaveBeenCalled()
      expect(mockShowSingleRun).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('runs after a test connection is configured even when Workspace authorization is absent', () => {
    const { result, store } = renderTool('app-user-auth')
    act(() =>
      store.getState().setNodeAppUserAuthDraft('tool-node', 'provider-name', 'provider-id', {
        ...appUserDraft,
        testConnection: {
          connections: [
            {
              id: 'test-key',
              name: 'Test key',
              method: CredentialTypeEnum.API_KEY,
              subtitle: '•••• 7A2F',
            },
          ],
          selectedId: 'missing-id',
        },
      }),
    )
    expect(result.current.singleRunDisabledReason).toBeUndefined()
    act(() => result.current.handleSingleRun())

    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledOnce()
    expect(mockHandleRun).toHaveBeenCalledExactlyOnceWith({})
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('restores running on switching to App user with its default mock connection and preserves required tool validation', async () => {
    const { result, store } = renderTool('workspace-auth', {
      ...appUserDraft,
      testConnection: undefined,
    })
    act(() =>
      store
        .getState()
        .setNodeAuthorizationTab('tool-node', 'provider-name', 'provider-id', 'app-user-auth'),
    )
    expect(result.current.singleRunDisabledReason).toBeUndefined()
    await act(async () => result.current.handleRunWithParams({ query: 'configured' }))
    expect(mockHandleRun).toHaveBeenCalledExactlyOnceWith({ query: 'configured' })
    expect(toast.error).not.toHaveBeenCalled()

    mockHandleRun.mockClear()
    mockHandleSyncWorkflowDraft.mockClear()
    mockToolValidationData.toolInputsSchema = [
      { required: true, variable: 'requiredQuery', label: 'Query' },
    ]
    // Re-entering the mode refreshes validation metadata while retaining the configured mock.
    act(() =>
      store
        .getState()
        .setNodeAuthorizationTab('tool-node', 'provider-name', 'provider-id', 'app-user-auth'),
    )
    act(() => result.current.handleSingleRun())
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalledWith('workflow.errorMsg.authRequired')
  })
})
