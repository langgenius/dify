import type { ReactNode } from 'react'
import { act, waitFor } from '@testing-library/react'
import { CanvasNodesCatalogProbe } from '@/app/components/workflow/__tests__/canvas-nodes-catalog-probe'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import DatasetsDetailProvider from '@/app/components/workflow/datasets-detail-store/provider'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { legacyWorkflowVersionHistoryKey } from '@/service/console/workflow-version-cache'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { useSnippetPublish } from '../use-snippet-publish'

const mockMutateAsync = vi.fn()

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'snippets.bySnippetId.workflows.publish.post': (...args: unknown[]) =>
        mockMutateAsync(...args),
    }),
  }
})

const historyKey = [...legacyWorkflowVersionHistoryKey, '/snippets/snippet-1/workflows']

const renderPublish = (code = 'def main():\n    return {"answer": "hello"}') => {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(historyKey, { pages: [{ data: [{ id: 'old-version' }] }] })
  const nodes = [
    createNode({
      id: 'code',
      data: {
        type: BlockEnum.Code,
        title: 'Code',
        code_language: CodeLanguage.python3,
        code,
        variables: [],
        outputs: { answer: { type: VarType.string, children: null } },
      },
    }),
  ]
  function PublishProviders({ children }: { children: ReactNode }) {
    return (
      <DatasetsDetailProvider nodes={nodes}>
        <CanvasNodesCatalogProbe />
        {children}
      </DatasetsDetailProvider>
    )
  }
  return {
    ...renderWorkflowCanvasHook(() => useSnippetPublish({ snippetId: 'snippet-1' }), {
      queryClient,
      nodes,
      wrapper: PublishProviders,
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
    }),
    queryClient,
  }
}

describe('useSnippetPublish', () => {
  beforeEach(() => {
    mockMutateAsync.mockResolvedValue({ created_at: 1_712_345_678 })
  })

  describe('Publish action', () => {
    it('should publish the snippet and show success feedback', async () => {
      const request = createDeferred<{ created_at: number }>()
      mockMutateAsync.mockReturnValueOnce(request.promise)
      const { result, queryClient, store } = renderPublish()

      const detailKey = consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryKey(
        { input: { params: { snippet_id: 'snippet-1' } } },
      )
      queryClient.setQueryData(detailKey, {
        id: 'snippet-1',
        name: 'Snippet',
        description: '',
        type: 'node',
        version: 1,
        use_count: 0,
        tags: [],
        graph: {},
        input_fields: [],
        icon_info: null,
        created_at: 0,
        updated_at: 0,
        created_by: null,
        updated_by: null,
        is_published: false,
      })

      let publishing!: ReturnType<typeof result.current.handlePublish>
      act(() => {
        publishing = result.current.handlePublish()
      })
      await waitFor(() => expect(result.current.isPublishing).toBe(true))
      expect(queryClient.getQueryData(detailKey)).toMatchObject({ is_published: false })
      expect(store.getState().publishedAt).toBe(0)
      expect(toast.success).not.toHaveBeenCalled()
      await act(async () => {
        request.resolve({ created_at: 1_712_345_678 })
        await expect(publishing).resolves.toBe(true)
      })
      await waitFor(() => expect(result.current.isPublishing).toBe(false))

      expect(mockMutateAsync).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-1' },
        body: {},
      })
      expect(queryClient.getQueryData(detailKey)).toMatchObject({ is_published: true })
      expect(store.getState().publishedAt).toBe(1_712_345_678_000)
      expect(queryClient.getQueryData(historyKey)).toBeUndefined()
      expect(toast.success).toHaveBeenCalledWith('snippet.publishSuccess')
    })

    it('should not publish the snippet when checklist validation fails', async () => {
      const { result, store, queryClient } = renderPublish('')

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('[Code]'))
      expect(store.getState().publishedAt).toBe(0)
      expect(queryClient.getQueryData(historyKey)).toEqual({
        pages: [{ data: [{ id: 'old-version' }] }],
      })
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should surface publish errors through toast feedback', async () => {
      mockMutateAsync.mockRejectedValue(new Error('publish failed'))

      const { result, store, queryClient } = renderPublish()

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(toast.error).toHaveBeenCalledWith('publish failed')
      expect(store.getState().publishedAt).toBe(0)
      expect(queryClient.getQueryData(historyKey)).toEqual({
        pages: [{ data: [{ id: 'old-version' }] }],
      })
      expect(toast.success).not.toHaveBeenCalled()
    })
  })
})
