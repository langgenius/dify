import IntegrationsRoutePage from '../page'

const mocks = vi.hoisted(() => ({
  getFeatures: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((_href: string) => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

// boundary: the console API transport.
vi.mock('@/service/console', () => ({
  consoleClient: { features: { get: () => mocks.getFeatures() } },
}))

// boundary: Next.js navigation, which only works inside a request.
vi.mock('@/next/navigation', () => ({
  notFound: () => mocks.notFound(),
  redirect: (href: string) => mocks.redirect(href),
}))

const visit = (...slug: string[]) => IntegrationsRoutePage({ params: Promise.resolve({ slug }) })

describe('integrations route segment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serves the malware scanners section when the workspace has the feature on', async () => {
    mocks.getFeatures.mockResolvedValue({ enable_file_scan: true })

    await expect(visit('file-scan')).resolves.toBeNull()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('sends the malware scanners section to model providers when the feature is off', async () => {
    mocks.getFeatures.mockResolvedValue({ enable_file_scan: false })

    await expect(visit('file-scan')).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/integrations/model-provider')
  })

  it('does not read the workspace features for any other section', async () => {
    await expect(visit('custom-endpoint')).resolves.toBeNull()
    await expect(visit('missing')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.getFeatures).not.toHaveBeenCalled()
  })
})
