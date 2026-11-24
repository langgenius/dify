import type { QueryKey } from '@tanstack/react-query'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { act, renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useDeleteWorkflow } from '../use-workflow'

const request = vi.hoisted(() => vi.fn<() => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))

const cases = [
  {
    resource: {
      kind: 'app',
      collaborationEnabled: false,
      appId: 'owner',
      mode: 'workflow',
    } satisfies EditorResource,
    path: '/apps/owner/workflows/version-1',
    key: (id: string) =>
      consoleQuery.apps.byAppId.workflows.get.key({
        type: 'infinite',
        input: { params: { app_id: id } },
      }),
  },
  {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'owner' } satisfies EditorResource,
    path: '/rag/pipelines/owner/workflows/version-1',
    key: (id: string) =>
      consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
        type: 'infinite',
        input: { params: { pipeline_id: id } },
      }),
  },
  {
    resource: { kind: 'snippet', snippetId: 'owner' } satisfies EditorResource,
    path: '/snippets/owner/workflows/version-1',
    key: (id: string) =>
      consoleQuery.snippets.bySnippetId.workflows.get.key({
        type: 'infinite',
        input: { params: { snippet_id: id } },
      }),
  },
]

it.each(cases)(
  'deletes a $resource.kind version and resets only its version lists',
  async ({ resource, path, key }) => {
    const { wrapper, queryClient } = createConsoleQueryWrapper()
    const affected = key('owner')
    const unrelated = key('other')
    const otherResources: QueryKey[] = cases
      .filter((item) => item.resource.kind !== resource.kind)
      .map((item) => item.key('owner'))
    for (const queryKey of [affected, unrelated, ...otherResources])
      queryClient.setQueryData(queryKey, { pages: [], pageParams: [] })
    request.mockResolvedValue(new Response(null, { status: 204 }))
    const { result, unmount } = renderHook(() => useDeleteWorkflow(resource), { wrapper })
    try {
      await act(() => result.current('version-1'))
      expect(request).toHaveBeenCalledWith(
        expect.stringContaining(path),
        expect.anything(),
        expect.objectContaining({ request: expect.objectContaining({ method: 'DELETE' }) }),
      )
      // Reset drops the cached pages so the list reloads from the first page.
      expect(queryClient.getQueryData(affected)).toBeUndefined()
      for (const queryKey of [unrelated, ...otherResources])
        expect(queryClient.getQueryData(queryKey)).toEqual({ pages: [], pageParams: [] })
    } finally {
      unmount()
      queryClient.clear()
      request.mockReset()
    }
  },
)
