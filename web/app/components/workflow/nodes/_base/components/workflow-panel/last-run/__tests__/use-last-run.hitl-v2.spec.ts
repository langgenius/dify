import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { act } from '@testing-library/react'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import HumanInputDefault from '@/app/components/workflow/nodes/human-input/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { lastRunQueryKey } from '@/service/workflow-queries'
import { createTestQueryClient } from '@/test/query-client'
import { TabType } from '../../types'
import useLastRun from '../use-last-run'

const mockHandleSyncWorkflowDraft = vi.fn()
const mockShowSingleRun = vi.fn()
const mockHandleRun = vi.fn()
const mockHideSingleRun = vi.fn()
const mockFetchInspectVars = vi.fn()

vi.mock('@/app/components/workflow/nodes/human-input/hooks/use-single-run-form-params', () => ({
  default: () => ({}),
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
  default: () => ({
    hideSingleRun: mockHideSingleRun,
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
    checkValid: vi.fn(() => ({ isValid: true })),
  }),
}))

const resource: EditorResource = {
  kind: 'app',
  collaborationEnabled: false,
  appId: 'flow-id',
  mode: 'workflow',
}

const humanInputData = (version?: string) => ({
  ...HumanInputDefault.defaultValue,
  type: BlockEnum.HumanInput,
  title: 'Human Input',
  desc: '',
  version,
})

describe('useLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchInspectVars.mockResolvedValue(undefined)
  })

  it.each([undefined, '2'])(
    'shows persisted variables after V2 form submission and preserves V1 last-run behavior (%s)',
    async (version) => {
      const queryClient = createTestQueryClient()
      const lastRunKey = lastRunQueryKey(resource, 'human-input-node')
      const otherLastRunKey = lastRunQueryKey(resource, 'other-node')
      queryClient.setQueryData(lastRunKey, { id: 'run-1' })
      queryClient.setQueryData(otherLastRunKey, { id: 'run-2' })
      const { result, store } = renderWorkflowCanvasHook(
        () =>
          useLastRun({
            id: 'human-input-node',
            resource: {
              kind: 'app',
              collaborationEnabled: false,
              appId: 'flow-id',
              mode: 'workflow',
            },

            data: humanInputData(version),
            defaultRunInputData: {},
            isPaused: false,
          }),
        { queryClient, hooksStoreProps: { fetchInspectVars: mockFetchInspectVars } },
      )
      await act(async () => {
        store.getState().setNodesWithInspectVars([
          {
            nodeId: 'human-input-node',
            title: 'Human Input',
            nodeType: BlockEnum.HumanInput,
            nodePayload: { type: BlockEnum.HumanInput, title: 'Human Input', desc: '' },
            vars: [],
            isValueFetched: true,
          },
        ])
        await result.current.handleAfterCustomSingleRun()
      })
      expect(mockHideSingleRun).toHaveBeenCalledOnce()
      if (version === '2') {
        expect(store.getState().showVariableInspectPanel).toBe(true)
        expect(store.getState().currentFocusNodeId).toBeNull()
        expect(mockFetchInspectVars).toHaveBeenCalledWith({})
        expect(result.current.tabType).toBe(TabType.settings)
        expect(queryClient.getQueryState(lastRunKey)?.isInvalidated).toBe(false)
      } else {
        expect(result.current.tabType).toBe(TabType.lastRun)
        expect(store.getState().nodesWithInspectVars[0]?.isValueFetched).toBe(true)
        expect(queryClient.getQueryState(lastRunKey)?.isInvalidated).toBe(true)
        expect(queryClient.getQueryState(otherLastRunKey)?.isInvalidated).toBe(false)
        expect(mockFetchInspectVars).not.toHaveBeenCalled()
      }
    },
  )

  it('waits for the real variable list refresh before opening a first V2 result with no cached node', async () => {
    let resolveRefresh!: () => void
    mockFetchInspectVars.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    const { result, store } = renderWorkflowCanvasHook(
      () =>
        useLastRun({
          id: 'human-input-node',
          resource: {
            kind: 'app',
            collaborationEnabled: false,
            appId: 'flow-id',
            mode: 'workflow',
          },

          data: humanInputData('2'),
          defaultRunInputData: {},
          isPaused: false,
        }),
      { hooksStoreProps: { fetchInspectVars: mockFetchInspectVars } },
    )
    expect(store.getState().nodesWithInspectVars).toEqual([])
    act(() => {
      store.getState().setCurrentFocusNodeId('previous-node')
    })
    let completion!: Promise<void>
    act(() => {
      completion = result.current.handleAfterCustomSingleRun()
    })
    expect(mockFetchInspectVars).toHaveBeenCalledWith({})
    expect(store.getState().showVariableInspectPanel).toBe(false)
    expect(mockHideSingleRun).not.toHaveBeenCalled()
    await act(async () => {
      resolveRefresh()
      await completion
    })
    expect(store.getState().showVariableInspectPanel).toBe(true)
    expect(store.getState().currentFocusNodeId).toBeNull()
    expect(mockHideSingleRun).toHaveBeenCalledOnce()
  })

  it('keeps the V2 form open when refreshing persisted results fails', async () => {
    mockFetchInspectVars.mockRejectedValueOnce(new Error('Variables unavailable'))
    const { result, store } = renderWorkflowCanvasHook(
      () =>
        useLastRun({
          id: 'human-input-node',
          resource: {
            kind: 'app',
            collaborationEnabled: false,
            appId: 'flow-id',
            mode: 'workflow',
          },

          data: humanInputData('2'),
          defaultRunInputData: {},
          isPaused: false,
        }),
      { hooksStoreProps: { fetchInspectVars: mockFetchInspectVars } },
    )
    await act(async () => {
      await expect(result.current.handleAfterCustomSingleRun()).rejects.toThrow(
        'Variables unavailable',
      )
    })
    expect(store.getState().showVariableInspectPanel).toBe(false)
    expect(mockHideSingleRun).not.toHaveBeenCalled()
  })
})
