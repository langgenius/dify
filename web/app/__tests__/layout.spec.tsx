import type { ReactNode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { isValidElement } from 'react'

let queryClient: QueryClient

const mocks = vi.hoisted(() => ({
  getSystemFeatures: vi.fn(),
  requestHeaders: new Headers(),
}))

vi.mock('@/features/system-features/server', () => ({
  getSystemFeaturesQueryClient: () => queryClient,
  systemFeaturesServerQueryOptions: () => ({
    queryKey: ['console', 'system-features'],
    queryFn: mocks.getSystemFeatures,
    retry: false,
  }),
}))

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()

  return {
    ...actual,
    getDatasetMap: () => ({}),
  }
})

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('@/next/headers', () => ({
  headers: async () => mocks.requestHeaders,
}))

function findDocumentTitle(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const title = findDocumentTitle(child)
      if (title !== undefined) return title
    }
    return undefined
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined
  if (node.type === 'title') return String(node.props.children)

  return findDocumentTitle(node.props.children)
}

describe('Root layout System Features bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('caches the resolved System Features for dehydration', async () => {
    mocks.getSystemFeatures.mockResolvedValue({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
      },
      deployment_edition: 'CLOUD',
    })
    const { default: RootLayout } = await import('../layout')

    const layout = await RootLayout({ children: <div>App</div> })

    expect(mocks.getSystemFeatures).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(['console', 'system-features'])).toEqual({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
      },
      deployment_edition: 'CLOUD',
    })
    expect(findDocumentTitle(layout)).toBe('Acme AI')
  })

  it('renders the client recovery path when the server prefetch fails', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('system features unavailable'))
    const { default: RootLayout } = await import('../layout')

    const layout = await RootLayout({ children: <div>App</div> })

    expect(queryClient.getQueryData(['console', 'system-features'])).toBeUndefined()
    expect(findDocumentTitle(layout)).toBe('Dify')
  })
})
