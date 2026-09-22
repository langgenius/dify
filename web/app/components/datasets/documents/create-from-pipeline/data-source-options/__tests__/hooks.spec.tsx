import type { PropsWithChildren } from 'react'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { useDatasourceIcon } from '../hooks'

const request = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  basePath: '/base',
}))

const node: DataSourceNodeType = {
  plugin_id: 'langgenius/file',
  provider_type: 'local_file',
  provider_name: 'file',
  datasource_name: 'local-file',
  datasource_label: 'Local File',
  datasource_parameters: {},
  datasource_configurations: {},
  title: 'DataSource',
  desc: '',
  type: BlockEnum.DataSource,
}

describe('useDatasourceIcon', () => {
  let client: QueryClient
  const key = consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    request.mockResolvedValue(Response.json([]))
  })
  afterEach(() => client.clear())

  it.each([
    ['/icon.png', '/base/icon.png'],
    ['/base/icon.png', '/base/icon.png'],
    ['https://example.com/icon.svg', 'https://example.com/icon.svg'],
    ['//example.com/icon.svg', '//example.com/icon.svg'],
  ])('projects %s without changing the shared response', async (icon, expected) => {
    const provider = createDatasourceProvider()
    provider.declaration.identity.icon = icon
    request.mockResolvedValue(Response.json([provider]))

    const { result } = renderHook(() => useDatasourceIcon(node), { wrapper })

    await waitFor(() => expect(result.current).toBe(expected))
    expect(client.getQueryData(key)).toEqual([provider])
    expect(request).toHaveBeenCalledOnce()
  })

  it('renders a cached icon while revalidating the catalog', () => {
    client.setQueryData(key, [createDatasourceProvider()])
    request.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useDatasourceIcon(node), { wrapper })
    expect(result.current).toBe('/base/datasource.svg')
  })

  it('returns no icon for a missing provider or a pending first request', async () => {
    const { result } = renderHook(() => useDatasourceIcon(node), { wrapper })
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'))
    expect(result.current).toBeUndefined()
  })

  it('resolves an older saved provider without plugin metadata', async () => {
    const provider = createDatasourceProvider()
    request.mockResolvedValue(Response.json([provider]))
    const { result } = renderHook(() => useDatasourceIcon({ ...node, plugin_id: '' }), { wrapper })
    await waitFor(() => expect(result.current).toBe('/base/datasource.svg'))
    expect(client.getQueryData(key)).toEqual([provider])
  })
})
