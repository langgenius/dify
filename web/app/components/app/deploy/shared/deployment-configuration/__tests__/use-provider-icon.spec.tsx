import type { UnsupportedNode } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { useGetProviderIcon } from '../use-provider-icon'

const request = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({}),
  useAllCustomTools: () => ({}),
  useAllWorkflowTools: () => ({}),
  useAllMCPTools: () => ({}),
}))
vi.mock('@/service/use-triggers', () => ({ useAllTriggerPlugins: () => ({}) }))
vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  basePath: '/base',
}))

const node: UnsupportedNode = {
  id: 'source-1',
  type: BlockEnum.DataSource,
  title: 'Local files',
  provider: {
    plugin_id: 'langgenius/file',
    provider_id: 'file',
    provider_name: 'file',
    provider_type: 'local_file',
  },
}

describe('deployment datasource icons', () => {
  let client: QueryClient
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    request.mockResolvedValue(Response.json([createDatasourceProvider()]))
  })
  afterEach(() => client.clear())

  it('admits the catalog only when a datasource node needs its icon', async () => {
    const { result, rerender } = renderHook(({ nodes }) => useGetProviderIcon(nodes), {
      initialProps: { nodes: [] as UnsupportedNode[] },
      wrapper,
    })
    expect(request).not.toHaveBeenCalled()

    rerender({ nodes: [node] })

    await waitFor(() => expect(result.current(node)).toBe('/base/datasource.svg'))
    expect(request).toHaveBeenCalledOnce()
    expect(
      client.getQueryData(consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()),
    ).toEqual([createDatasourceProvider()])
  })

  it('returns no icon when the deployment node has no provider metadata', () => {
    const unknown: UnsupportedNode = { id: 'unknown', type: 'human-input', title: 'Input' }
    const { result } = renderHook(() => useGetProviderIcon([unknown]), { wrapper })
    expect(result.current(unknown)).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })
})
