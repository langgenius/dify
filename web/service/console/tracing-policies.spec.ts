import type { QueryClient } from '@tanstack/react-query'
import { MutationObserver } from '@tanstack/react-query'
import { createTestQueryClient } from '@/test/query-client'
import { consoleQuery } from './index'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('../base', () => ({ request }))

const app = consoleQuery.apps.byAppId
const input = {
  params: { app_id: 'app-1' },
  body: { tracing_provider: 'langfuse', tracing_config: {} },
}
const statusKey = (appId: string) =>
  app.trace.get.queryKey({ input: { params: { app_id: appId } } })
const configKey = (appId: string, provider: string) =>
  app.traceConfig.get.queryKey({
    input: { params: { app_id: appId }, query: { tracing_provider: provider } },
  })
const mutations = [
  {
    name: 'status',
    affectedKey: statusKey('app-1'),
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, app.trace.post.mutationOptions({ onSuccess })).mutate({
        params: input.params,
        body: { enabled: false, tracing_provider: 'langfuse' },
      }),
  },
  {
    name: 'create config',
    affectedKey: configKey('app-1', 'langfuse'),
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, app.traceConfig.post.mutationOptions({ onSuccess })).mutate(
        input,
      ),
  },
  {
    name: 'update config',
    affectedKey: configKey('app-1', 'langfuse'),
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, app.traceConfig.patch.mutationOptions({ onSuccess })).mutate(
        input,
      ),
  },
  {
    name: 'delete config',
    affectedKey: configKey('app-1', 'langfuse'),
    run: (client: QueryClient, onSuccess: () => void) =>
      new MutationObserver(client, app.traceConfig.delete.mutationOptions({ onSuccess })).mutate({
        params: input.params,
        query: { tracing_provider: 'langfuse' },
      }),
  },
]

describe('App tracing mutation cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(mutations)(
    '$name invalidates only its app and provider while preserving local feedback',
    async ({ run, affectedKey }) => {
      const client = createTestQueryClient()
      const onSuccess = vi.fn()
      const unrelatedKeys = [
        statusKey('app-2'),
        configKey('app-2', 'langfuse'),
        configKey('app-1', 'mlflow'),
      ]
      for (const appId of ['app-1', 'app-2']) {
        client.setQueryData(statusKey(appId), { enabled: true })
        for (const provider of ['langfuse', 'mlflow'])
          client.setQueryData(configKey(appId, provider), { has_not_configured: false })
      }
      request.mockImplementation(async (_url, _init, { request: sent }) =>
        sent.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json({ result: 'success' }),
      )

      await run(client, onSuccess)

      expect(onSuccess).toHaveBeenCalledOnce()
      expect(client.getQueryState(affectedKey)?.isInvalidated).toBe(true)
      for (const key of unrelatedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
      client.clear()
    },
  )
})
