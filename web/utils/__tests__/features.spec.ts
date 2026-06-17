describe('features', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should disable Agent v2 by default', async () => {
    vi.doMock('@/env', () => ({
      env: {
        NEXT_PUBLIC_ENABLE_AGENT_V2: false,
      },
    }))

    const { isAgentV2Enabled, isFeatureEnabled } = await import('../features')

    expect(isFeatureEnabled('agentV2')).toBe(false)
    expect(isAgentV2Enabled()).toBe(false)
  })

  it('should enable Agent v2 when the runtime env flag is true', async () => {
    vi.doMock('@/env', () => ({
      env: {
        NEXT_PUBLIC_ENABLE_AGENT_V2: true,
      },
    }))

    const { isAgentV2Enabled, isFeatureEnabled } = await import('../features')

    expect(isFeatureEnabled('agentV2')).toBe(true)
    expect(isAgentV2Enabled()).toBe(true)
  })
})
