import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { MutationObserver } from '@tanstack/react-query'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { consoleQuery } from '../index'

const request = vi.hoisted(() => vi.fn<() => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))

const cases = [
  {
    name: 'app',
    keys: (id: string) => [
      consoleQuery.apps.byAppId.workflowRuns.get.queryKey({ input: { params: { app_id: id } } }),
      consoleQuery.apps.byAppId.advancedChat.workflowRuns.get.queryKey({
        input: { params: { app_id: id } },
      }),
      consoleQuery.apps.byAppId.workflowRuns.byRunId.get.queryKey({
        input: { params: { app_id: id, run_id: 'run-1' } },
      }),
    ],
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        consoleQuery.apps.byAppId.workflowRuns.tasks.byTaskId.stop.post.mutationOptions(),
      ).mutate({ params: { app_id: 'owner', task_id: 'task' } }),
  },
  {
    name: 'pipeline',
    keys: (id: string) => [
      consoleQuery.rag.pipelines.byPipelineId.workflowRuns.get.queryKey({
        input: { params: { pipeline_id: id } },
      }),
      consoleQuery.rag.pipelines.byPipelineId.workflowRuns.byRunId.get.queryKey({
        input: { params: { pipeline_id: id, run_id: 'run-1' } },
      }),
    ],
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        consoleQuery.rag.pipelines.byPipelineId.workflowRuns.tasks.byTaskId.stop.post.mutationOptions(),
      ).mutate({ params: { pipeline_id: 'owner', task_id: 'task' } }),
  },
  {
    name: 'snippet',
    keys: (id: string) => [
      consoleQuery.snippets.bySnippetId.workflowRuns.get.queryKey({
        input: { params: { snippet_id: id } },
      }),
      consoleQuery.snippets.bySnippetId.workflowRuns.byRunId.get.queryKey({
        input: { params: { snippet_id: id, run_id: 'run-1' } },
      }),
    ],
    run: (client: QueryClient) =>
      new MutationObserver(
        client,
        consoleQuery.snippets.bySnippetId.workflowRuns.tasks.byTaskId.stop.post.mutationOptions(),
      ).mutate({ params: { snippet_id: 'owner', task_id: 'task' } }),
  },
]

it.each(cases)(
  'refreshes only the stopped $name resource after success or a lost response',
  async ({ keys, run }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const failed of [false, true]) {
        const client = createConsoleQueryClient()
        const affected: QueryKey[] = keys('owner')
        const unrelated: QueryKey[] = keys('other')
        for (const key of [...affected, ...unrelated]) client.setQueryData(key, { cached: true })
        if (failed) request.mockRejectedValue(new TypeError('Connection lost'))
        else request.mockResolvedValue(Response.json({ result: 'success' }))
        try {
          if (failed) await expect(run(client)).rejects.toThrow('Connection lost')
          else await run(client)
          for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
          for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
        } finally {
          client.clear()
        }
      }
    } finally {
      vi.restoreAllMocks()
    }
  },
)
