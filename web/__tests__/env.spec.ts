describe('env runtime transport', () => {
  const originalAgentV2Env = process.env.NEXT_PUBLIC_ENABLE_AGENT_V2

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('../utils/client')
    document.body.removeAttribute('data-enable-agent-v2')
    document.body.removeAttribute('data-enable-agent-v-2')
    delete process.env.NEXT_PUBLIC_ENABLE_AGENT_V2
  })

  afterAll(() => {
    if (originalAgentV2Env === undefined)
      delete process.env.NEXT_PUBLIC_ENABLE_AGENT_V2
    else
      process.env.NEXT_PUBLIC_ENABLE_AGENT_V2 = originalAgentV2Env
  })

  it('should read NEXT_PUBLIC_ENABLE_AGENT_V2 from the browser runtime dataset key', async () => {
    document.body.setAttribute('data-enable-agent-v2', 'true')

    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_ENABLE_AGENT_V2).toBe(true)
  })

  it('should emit the Agent v2 runtime dataset attribute from getDatasetMap on the server', async () => {
    process.env.NEXT_PUBLIC_ENABLE_AGENT_V2 = 'true'

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-enable-agent-v2']).toBe(true)
    expect(datasetMap['data-enable-agent-v-2']).toBeUndefined()
  })
})
