import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useKnowledgeBatchUpload } from '../use-batch-upload'

const getFeatures = vi.hoisted(() => vi.fn())
const editionMock = vi.hoisted(() => ({ value: 'CLOUD' }))

vi.mock('@/features/system-features/state', async () => {
  const { atom } = await import('jotai')
  return { deploymentEditionAtom: atom(() => editionMock.value) }
})

vi.mock('@/service/console', () => ({
  consoleQuery: {
    features: {
      get: {
        queryOptions: (options: object) => ({
          queryKey: ['features'],
          queryFn: getFeatures,
          ...options,
        }),
      },
    },
  },
}))

function renderUploadPolicy(edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE') {
  const store = createStore()
  editionMock.value = edition
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Provider>
  )
  return renderHook(() => useKnowledgeBatchUpload(), { wrapper })
}

beforeEach(() => {
  getFeatures.mockReset()
})

it.each([
  ['sandbox', false],
  ['professional', true],
  ['team', true],
] as const)(
  'uses the workspace %s subscription to determine batch upload',
  async (plan, expected) => {
    getFeatures.mockResolvedValue({ billing: { subscription: { plan } } })
    const { result } = renderUploadPolicy('CLOUD')
    await waitFor(() => expect(getFeatures).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current).toBe(expected))
  },
)

it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
  'preserves batch upload without billing in %s',
  (edition) => {
    const { result } = renderUploadPolicy(edition)
    expect(result.current).toBe(true)
    expect(getFeatures).not.toHaveBeenCalled()
  },
)

it('allows only a single file until the paid subscription is available', async () => {
  let resolveFeatures!: (value: unknown) => void
  getFeatures.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFeatures = resolve
      }),
  )
  const { result } = renderUploadPolicy('CLOUD')
  expect(result.current).toBe(false)
  await act(async () => resolveFeatures({ billing: { subscription: { plan: 'professional' } } }))
  await waitFor(() => expect(result.current).toBe(true))
})

it('keeps the single-file fallback when billing cannot be read', async () => {
  getFeatures.mockRejectedValue(new Error('billing unavailable'))
  const { result } = renderUploadPolicy('CLOUD')
  await waitFor(() => expect(getFeatures).toHaveBeenCalledOnce())
  expect(result.current).toBe(false)
})
