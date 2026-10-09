import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { consoleQuery } from '@/service/console'
import ActionList from '../datasource-action-list'

const request = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({ 'plugin.detailPanel.actionNum': '{{num}} {{action}}' })
})

describe('datasource action list', () => {
  let client: QueryClient
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })
  afterEach(() => client.clear())

  it('retains the zero-action heading for a matching installed provider', async () => {
    const provider = createDatasourceProvider()
    request.mockResolvedValue(Response.json([provider]))
    render(<ActionList detail={{ plugin_id: provider.plugin_id }} />, { wrapper })

    expect(await screen.findByText('0 action')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      client.getQueryData(consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey()),
    ).toEqual([provider])
  })

  it('does not show the heading for a different installed plugin', async () => {
    request.mockResolvedValue(Response.json([createDatasourceProvider()]))
    const { container } = render(<ActionList detail={{ plugin_id: 'missing/plugin' }} />, {
      wrapper,
    })

    await waitFor(() =>
      expect(
        client.getQueryState(consoleQuery.rag.pipelines.datasourcePlugins.get.queryKey())?.status,
      ).toBe('success'),
    )
    expect(container).toBeEmptyDOMElement()
  })
})
