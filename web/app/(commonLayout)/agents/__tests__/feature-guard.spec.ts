const mocks = vi.hoisted(() => ({
  agentV2Enabled: true,
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/env', () => ({
  env: {
    get NEXT_PUBLIC_ENABLE_AGENT_V2() {
      return mocks.agentV2Enabled
    },
  },
}))

vi.mock('@/next/navigation', () => ({
  notFound: () => mocks.notFound(),
}))

describe('guardAgentV2Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentV2Enabled = true
  })

  it('should allow roster routes when Agent v2 is enabled', async () => {
    const { guardAgentV2Route } = await import('../feature-guard')

    expect(() => guardAgentV2Route()).not.toThrow()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('should throw notFound when Agent v2 is disabled', async () => {
    mocks.agentV2Enabled = false

    const { guardAgentV2Route } = await import('../feature-guard')

    expect(() => guardAgentV2Route()).toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
