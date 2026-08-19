describe('env runtime transport', () => {
  const originalAgentV2Env = process.env.NEXT_PUBLIC_ENABLE_AGENT_V2
  const originalMarkdownFormFieldNameExtraChars =
    process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
  const originalTurnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('../utils/client')
    document.body.removeAttribute('data-enable-agent-v2')
    document.body.removeAttribute('data-enable-agent-v-2')
    document.body.removeAttribute('data-markdown-form-field-name-extra-chars')
    document.body.removeAttribute('data-turnstile-site-key')
    delete process.env.NEXT_PUBLIC_ENABLE_AGENT_V2
    delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  })

  afterAll(() => {
    if (originalAgentV2Env === undefined) delete process.env.NEXT_PUBLIC_ENABLE_AGENT_V2
    else process.env.NEXT_PUBLIC_ENABLE_AGENT_V2 = originalAgentV2Env
    if (originalMarkdownFormFieldNameExtraChars === undefined)
      delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
    else
      process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS =
        originalMarkdownFormFieldNameExtraChars
    if (originalTurnstileSiteKey === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey
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

  it('should read Markdown form field name extra characters from the browser runtime dataset', async () => {
    document.body.setAttribute('data-markdown-form-field-name-extra-chars', '()!*&（）！＊＆－')

    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS).toBe('()!*&（）！＊＆－')
  })

  it('should emit Markdown form field name extra characters in the server runtime dataset', async () => {
    process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS = '()!*&（）！＊＆－'

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-markdown-form-field-name-extra-chars']).toBe('()!*&（）！＊＆－')
  })

  it('should read the Turnstile site key from the browser runtime dataset', async () => {
    document.body.setAttribute('data-turnstile-site-key', 'site-key-for-tests')

    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe('site-key-for-tests')
  })

  it('should emit the Turnstile site key in the server runtime dataset', async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key-for-tests'

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-turnstile-site-key']).toBe('site-key-for-tests')
  })
})
