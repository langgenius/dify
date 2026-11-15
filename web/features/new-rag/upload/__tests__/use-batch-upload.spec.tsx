import { act, waitFor } from '@testing-library/react'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useKnowledgeBatchUpload } from '../use-batch-upload'

const getFeatures = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'features.get': getFeatures }),
  }
})

function renderUploadPolicy(edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE') {
  return renderHookWithConsoleQuery(() => useKnowledgeBatchUpload(), {
    systemFeatures: { deployment_edition: edition },
  })
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
