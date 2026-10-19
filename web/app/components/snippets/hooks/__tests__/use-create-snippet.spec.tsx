import { act, waitFor } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useCreateSnippet } from '../use-create-snippet'

const {
  mockMutateAsync,
  mockPush,
  mockSyncDraftWorkflow,
  mockToastError,
  mockToastSuccess,
  mockWorkspacePermissionKeys,
} = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockPush: vi.fn(),
  mockSyncDraftWorkflow: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockWorkspacePermissionKeys: vi.fn(() => ['snippets.create_and_modify']),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys(),
  }))
})

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.post': mockMutateAsync,
      'snippets.bySnippetId.workflows.draft.post': mockSyncDraftWorkflow,
    }),
  }
})

describe('useCreateSnippet', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWorkspacePermissionKeys.mockReturnValue(['snippets.create_and_modify'])
  })

  describe('Create Flow', () => {
    it('should create snippet with graph and navigate on success', async () => {
      mockMutateAsync.mockResolvedValue({ id: 'snippet-123' })
      const draftSave = createDeferred<{ result: string; hash: string; updated_at: number }>()
      mockSyncDraftWorkflow.mockReturnValueOnce(draftSave.promise)
      const graph = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const { result } = renderHook(() => useCreateSnippet())

      act(() => {
        result.current.handleOpenCreateSnippetDialog()
      })

      let creating!: ReturnType<typeof result.current.handleCreateSnippet>
      act(() => {
        creating = result.current.handleCreateSnippet({
          name: 'My snippet',
          description: 'desc',
          input_fields: [
            {
              label: 'topic',
              variable: 'topic',
              type: PipelineInputVarType.textInput,
              required: true,
            },
          ],
          graph,
        })
      })

      await waitFor(() => expect(mockSyncDraftWorkflow).toHaveBeenCalledOnce())
      expect(result.current.isCreatingSnippet).toBe(true)
      expect(result.current.isCreateSnippetDialogOpen).toBe(true)
      expect(mockPush).not.toHaveBeenCalled()
      await act(async () => {
        draftSave.resolve({ result: 'success', hash: 'draft-hash', updated_at: 1704067200 })
        await creating
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        body: {
          name: 'My snippet',
          description: 'desc',
          graph,
          input_fields: [
            {
              label: 'topic',
              variable: 'topic',
              type: PipelineInputVarType.textInput,
              required: true,
            },
          ],
        },
      })
      expect(mockSyncDraftWorkflow).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-123' },
        body: {
          graph,
          input_fields: [
            {
              label: 'topic',
              variable: 'topic',
              type: PipelineInputVarType.textInput,
              required: true,
            },
          ],
        },
      })
      expect(mockPush).toHaveBeenCalledWith('/snippets/snippet-123/orchestrate')
      expect(result.current.isCreateSnippetDialogOpen).toBe(false)
      expect(result.current.isCreatingSnippet).toBe(false)
    })

    it('should rely on API error handling when create fails', async () => {
      mockMutateAsync.mockRejectedValue(new Error('create failed'))

      const { result } = renderHook(() => useCreateSnippet())

      await act(async () => {
        await result.current.handleCreateSnippet({
          name: 'My snippet',
          description: '',
          input_fields: [],
          graph: {
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        })
      })

      expect(mockToastError).not.toHaveBeenCalled()
      expect(mockSyncDraftWorkflow).not.toHaveBeenCalled()
      expect(mockPush).not.toHaveBeenCalled()
      expect(result.current.isCreatingSnippet).toBe(false)
    })
  })
})
