describe('Agent v2 feature flags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('reads the client-visible Agent v2 flag from NEXT_PUBLIC_ENABLE_AGENT_V2', async () => {
    vi.doMock('@/env', () => ({
      env: {
        NEXT_PUBLIC_ENABLE_AGENT_V2: true,
      },
    }))

    const { isAgentV2Enabled } = await import('../feature-flag')

    expect(isAgentV2Enabled()).toBe(true)
  })
})
