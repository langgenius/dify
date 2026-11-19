import type { ReactElement } from 'react'
import type { Source } from '../source-models'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { vi } from 'vite-plus/test'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { permissionState, server, sourceResponses } from './source-server'

const clients = new Set<ReturnType<typeof createConsoleQueryWrapper>['queryClient']>()
export function clearSourceClients() {
  clients.forEach((client) => client.clear())
  clients.clear()
}

export async function settle() {
  await vi.waitUntil(() => server.inflight === 0)
}
export const lastInput = (resource: string) => server.inputs.get(resource)?.at(-1)
export async function renderSources(
  ui: ReactElement,
  {
    searchParams = '',
    settle: shouldSettle = true,
  }: { searchParams?: string; settle?: boolean } = {},
) {
  const onUrlUpdate = vi.fn()
  const { queryClient } = createConsoleQueryWrapper({
    currentWorkspace: { id: 'workspace-123' },
    workspacePermissionKeys: permissionState.workspacePermissionKeys,
  })
  clients.add(queryClient)
  const withProviders = (content: ReactElement) => (
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        <KnowledgeSpaceTestProvider
          space={createKnowledgeSpaceFixture({
            permission_keys: permissionState.knowledgeSpacePermissionKeys,
          })}
        >
          <div className="@container/knowledge-content">{content}</div>
          <AppToaster />
        </KnowledgeSpaceTestProvider>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>
  )
  const rendered = await render(withProviders(ui))
  if (shouldSettle) await settle()
  return {
    ...rendered,
    onUrlUpdate,
    queryClient,
    async refresh() {
      await queryClient.invalidateQueries({ queryKey: consoleQuery.knowledgeFs.spaces.key() })
      await settle()
    },
  }
}
export async function measurePollIntervalFor(
  queryClient: ReturnType<typeof createConsoleQueryWrapper>['queryClient'],
  sources: Source[],
) {
  sourceResponses.data = { pages: [{ items: sources }] }
  await queryClient.invalidateQueries({ queryKey: consoleQuery.knowledgeFs.spaces.key() })
  await settle()
  const reads = server.reads.get('sources') ?? 0
  for (let elapsed = 250; elapsed <= 6000; elapsed += 250) {
    await vi.advanceTimersByTimeAsync(250)
    if ((server.reads.get('sources') ?? 0) > reads) return Math.round(elapsed / 1000) * 1000
  }
  return false
}
