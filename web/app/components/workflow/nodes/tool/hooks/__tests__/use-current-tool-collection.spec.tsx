import { CollectionType } from '@/app/components/tools/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import useCurrentToolCollection from '../use-current-tool-collection'

const endpoints = [
  [CollectionType.builtIn, consoleQuery.workspaces.current.tools.builtin.get],
  [CollectionType.custom, consoleQuery.workspaces.current.tools.api.get],
  [CollectionType.workflow, consoleQuery.workspaces.current.tools.workflow.get],
  [CollectionType.mcp, consoleQuery.workspaces.current.tools.mcp.get],
] as const

it.each(endpoints)('selects the %s catalog and clears a missing provider match', (type) => {
  const queryClient = createConsoleQueryClient()
  for (const [category, endpoint] of endpoints) {
    const provider = createToolProviderFixture({
      id: 'shared-id',
      name: `${category}-provider`,
      type: category,
      author: 'test',
      label: { en_US: category },
      description: { en_US: 'Provider' },
      icon: '',
      tools: [],
    })
    queryClient.setQueryData(endpoint.queryKey(), [provider])
  }
  const { result, rerender } = renderHookWithConsoleQuery(
    ({ id }) => useCurrentToolCollection(type, id),
    { initialProps: { id: 'shared-id' }, queryClient },
  )
  expect(result.current.currentTools).toMatchObject([{ name: `${type}-provider` }])
  expect(result.current.currCollection).toMatchObject({ id: 'shared-id', name: `${type}-provider` })
  rerender({ id: 'missing' })
  expect(result.current.currentTools).toHaveLength(1)
  expect(result.current.currCollection).toBeUndefined()
})
