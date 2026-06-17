const mocks = vi.hoisted(() => ({
  isAgentV2Enabled: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/utils/features', () => ({
  isAgentV2Enabled: () => mocks.isAgentV2Enabled(),
}))

vi.mock('@/next/navigation', () => ({
  notFound: () => mocks.notFound(),
}))

describe('guardAgentV2Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isAgentV2Enabled.mockReturnValue(true)
  })

  it('should allow roster routes when Agent v2 is enabled', async () => {
    const { guardAgentV2Route } = await import('../feature-guard')

    expect(() => guardAgentV2Route()).not.toThrow()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('should throw notFound when Agent v2 is disabled', async () => {
    mocks.isAgentV2Enabled.mockReturnValue(false)

    const { guardAgentV2Route } = await import('../feature-guard')

    expect(() => guardAgentV2Route()).toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
