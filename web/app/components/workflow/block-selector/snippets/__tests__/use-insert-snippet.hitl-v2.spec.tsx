import type { SnippetWorkflowResponse } from '@dify/contracts/api/console/snippets/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createTestQueryClient } from '@/test/query-client'
import HumanInputDefault from '../../../nodes/human-input/default'
import { createDefaultFormInputByType } from '../../../nodes/human-input/types'
import { InputVarType } from '../../../types'
import { useInsertSnippet } from '../use-insert-snippet'

const mockRequest = vi.hoisted(() => vi.fn())
const releaseGate = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))
const mockHandleSyncWorkflowDraft = vi.fn()
const mockSaveStateToHistory = vi.fn()
const mockToastError = vi.fn()
const mockToastWarning = vi.fn()
const mockGetNodes = vi.fn()
const mockSetNodes = vi.fn()
const mockSetEdges = vi.fn()
const mockIncrementSnippetUseCount = vi.fn()
let mockEdges: unknown[] = [{ id: 'existing-edge', source: 'old', target: 'old-2' }]

vi.mock('@/service/base', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  sseGeneratorPost: vi.fn(),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
      setNodes: mockSetNodes,
      edges: mockEdges,
      setEdges: mockSetEdges,
    }),
  }),
}))

vi.mock('../../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('../../../hooks/use-workflow-history', () => ({
  useWorkflowHistory: () => ({
    saveStateToHistory: mockSaveStateToHistory,
  }),
  WorkflowHistoryEvent: {
    NodePaste: 'NodePaste',
  },
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}))

vi.mock('@/service/use-snippets', () => ({
  useIncrementSnippetUseCountMutation: () => ({
    mutate: mockIncrementSnippetUseCount,
  }),
}))

type PublishedWorkflow = Pick<SnippetWorkflowResponse, 'graph'>

const seedPublishedWorkflow = (queryClient: QueryClient, workflow: PublishedWorkflow) => {
  const queryOptions = consoleQuery.snippets.bySnippetId.workflows.publish.get.queryOptions({
    input: {
      params: { snippet_id: 'snippet-1' },
    },
  })

  queryClient.setQueryData<PublishedWorkflow>(queryOptions.queryKey, workflow)
}

describe('useInsertSnippet', () => {
  let queryClient: QueryClient
  const renderUseInsertSnippet = () =>
    renderHook(() => useInsertSnippet(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

  beforeEach(() => {
    vi.clearAllMocks()
    releaseGate.enabled = true
    queryClient = createTestQueryClient()
    mockEdges = [{ id: 'existing-edge', source: 'old', target: 'old-2' }]
    mockGetNodes.mockReturnValue([
      {
        id: 'existing-node',
        position: { x: 0, y: 0 },
        data: { selected: true },
      },
    ])
  })

  afterEach(() => {
    queryClient.clear()
  })

  describe('Insert Flow', () => {
    it.each([undefined, '2'])(
      'allows only legacy snippet approvals (version %s) when the release gate is off',
      async (version) => {
        releaseGate.enabled = false
        const data = {
          ...HumanInputDefault.defaultValue,
          type: 'human-input',
          title: 'Approval',
          ...(version ? { version } : {}),
        }
        mockGetNodes.mockReturnValue([
          {
            id: 'existing-legacy',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: version
              ? { type: 'code', title: 'Existing code' }
              : { ...HumanInputDefault.defaultValue, type: 'human-input' },
          },
        ])
        seedPublishedWorkflow(queryClient, {
          graph: {
            nodes: [{ id: 'snippet-approval', type: 'custom', position: { x: 10, y: 20 }, data }],
            edges: [],
          },
        })
        const { result } = renderUseInsertSnippet()

        await act(async () => result.current.handleInsertSnippet('snippet-1'))

        if (version) {
          expect(mockToastWarning).toHaveBeenCalledWith('workflow.nodes.humanInputV2.disabled')
          expect(mockSetNodes).not.toHaveBeenCalled()
          expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
        } else {
          expect(mockSetNodes).toHaveBeenCalledTimes(1)
          expect(mockSetNodes.mock.lastCall![0]).toHaveLength(2)
          expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
        }
      },
    )

    it('keeps legacy-only snippets usable when existing legacy fields cannot migrate', async () => {
      const data = {
        ...HumanInputDefault.defaultValue,
        inputs: [createDefaultFormInputByType(InputVarType.select, 'decision')],
      }
      mockGetNodes.mockReturnValue([
        { id: 'legacy-human-input', type: 'custom', position: { x: 0, y: 0 }, data },
      ])
      seedPublishedWorkflow(queryClient, {
        graph: {
          nodes: [{ id: 'snippet-human-input', type: 'custom', position: { x: 10, y: 20 }, data }],
          edges: [],
        },
      })
      const { result } = renderUseInsertSnippet()

      await act(async () => result.current.handleInsertSnippet('snippet-1'))

      expect(mockToastWarning).not.toHaveBeenCalled()
      expect(mockSetNodes).toHaveBeenCalledTimes(1)
      expect(mockSetNodes.mock.lastCall![0]).toHaveLength(2)
      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    })

    it('blocks snippets containing Human Input while the draft has a legacy node', async () => {
      mockGetNodes.mockReturnValue([
        {
          id: 'legacy-human-input',
          position: { x: 0, y: 0 },
          data: { type: 'human-input' },
        },
      ])
      seedPublishedWorkflow(queryClient, {
        graph: {
          nodes: [
            {
              id: 'snippet-human-input',
              position: { x: 10, y: 20 },
              data: { type: 'human-input', version: '2' },
            },
          ],
          edges: [],
        },
      })
      const { result } = renderUseInsertSnippet()

      await act(async () => {
        expect(await result.current.handleInsertSnippet('snippet-1')).toBe(false)
      })

      expect(mockToastWarning).toHaveBeenCalledWith(
        'workflow.nodes.humanInputMigration.disabledReason',
      )
      expect(mockSetNodes).not.toHaveBeenCalled()
      expect(mockSetEdges).not.toHaveBeenCalled()
      expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    })
  })
})
