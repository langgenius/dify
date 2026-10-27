import type { PropsWithChildren } from 'react'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import OptionCard from '../option-card'

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

describe('OptionCard', () => {
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

  it('resolves an installed provider icon without mutating the shared catalog response', async () => {
    const icon = '/icon.png'
    const expected = '/base/icon.png'
    const provider = createDatasourceProvider()
    provider.declaration.identity.icon = icon
    request.mockResolvedValue(Response.json([provider]))

    const { container } = render(<OptionCard label="Local File" selected nodeData={node} />, {
      wrapper,
    })

    await waitFor(() =>
      expect(container.querySelector('.bg-cover')).toHaveStyle({
        backgroundImage: `url("${expected}")`,
      }),
    )
    expect(client.getQueryData(key)).toEqual([provider])
    expect(request).toHaveBeenCalledOnce()
  })

  it('renders a cached icon while revalidating the catalog', () => {
    client.setQueryData(key, [createDatasourceProvider()])
    request.mockReturnValue(new Promise(() => {}))

    const { container } = render(<OptionCard label="Local File" selected nodeData={node} />, {
      wrapper,
    })

    expect(container.querySelector('.bg-cover')).toHaveStyle({
      backgroundImage: 'url("/base/datasource.svg")',
    })
  })

  it('keeps a missing or pending provider icon empty instead of constructing a URL', async () => {
    const { container } = render(
      <OptionCard label="Local File" selected={false} nodeData={node} />,
      { wrapper },
    )

    expect(container.querySelector<HTMLElement>('.bg-cover')?.style.backgroundImage).toBe('')
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'))
    expect(container.querySelector<HTMLElement>('.bg-cover')?.style.backgroundImage).toBe('')
    expect(screen.getByText('Local File')).toBeInTheDocument()
  })

  it('resolves an older saved provider without plugin metadata', async () => {
    const provider = createDatasourceProvider()
    request.mockResolvedValue(Response.json([provider]))
    const { container } = render(
      <OptionCard label="Local File" selected={false} nodeData={{ ...node, plugin_id: '' }} />,
      { wrapper },
    )

    await waitFor(() =>
      expect(container.querySelector('.bg-cover')).toHaveStyle({
        backgroundImage: 'url("/base/datasource.svg")',
      }),
    )
    expect(client.getQueryData(key)).toEqual([provider])
  })
})
