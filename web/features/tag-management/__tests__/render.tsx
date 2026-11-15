import type { TagResponse, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'

const clients: QueryClient[] = []

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
})

export function renderWithTags(ui: ReactElement, tags: TagResponse[]) {
  const queryClient = createTestQueryClient()
  clients.push(queryClient)
  const types: TagType[] = ['app', 'knowledge', 'snippet', 'skill']
  for (const type of types) {
    queryClient.setQueryData(consoleQuery.tags.get.queryKey({ input: { query: { type } } }), tags)
  }
  return { ...render(ui, { wrapper: createQueryClientWrapper(queryClient) }), queryClient }
}
