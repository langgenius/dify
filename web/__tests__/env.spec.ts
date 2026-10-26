describe('env runtime transport', () => {
  const envKeys = [
    'NEXT_PUBLIC_ENABLE_AGENT_V2',
    'NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS',
    'NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  ] as const
  const attributes = [
    'data-enable-agent-v2',
    'data-enable-agent-v-2',
    'data-markdown-form-field-name-extra-chars',
    'data-markdown-form-field-name-max-length',
    'data-turnstile-site-key',
  ]
  let previousAttributes: (string | null)[]

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../utils/client')
    previousAttributes = attributes.map((name) => document.body.getAttribute(name))
    attributes.forEach((name) => document.body.removeAttribute(name))
    envKeys.forEach((name) => vi.stubEnv(name, undefined))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('../utils/client')
    attributes.forEach((name, index) => {
      const value = previousAttributes[index]
      if (value == null) document.body.removeAttribute(name)
      else document.body.setAttribute(name, value)
    })
  })

  it('should read NEXT_PUBLIC_ENABLE_AGENT_V2 from the browser runtime dataset key', async () => {
    document.body.setAttribute('data-enable-agent-v2', 'true')

    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_ENABLE_AGENT_V2).toBe(true)
  })

  it('should emit the Agent v2 runtime dataset attribute from getDatasetMap on the server', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_AGENT_V2', 'true')

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
    vi.stubEnv('NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS', '()!*&（）！＊＆－')

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-markdown-form-field-name-extra-chars']).toBe('()!*&（）！＊＆－')
  })

  it('should default the Markdown form field name maximum length to 128', async () => {
    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH).toBe(128)
  })

  it('should read the Markdown form field name maximum length from the browser runtime dataset', async () => {
    document.body.setAttribute('data-markdown-form-field-name-max-length', '64')

    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH).toBe(64)
  })

  it('should emit the Markdown form field name maximum length in the server runtime dataset', async () => {
    vi.stubEnv('NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH', '64')

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-markdown-form-field-name-max-length']).toBe(64)
  })

  it('should read the Turnstile site key from the browser runtime dataset', async () => {
    document.body.setAttribute('data-turnstile-site-key', 'site-key-for-tests')

    const { env } = await import('../env')

    expect(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe('site-key-for-tests')
  })

  it('should emit the Turnstile site key in the server runtime dataset', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-for-tests')

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-turnstile-site-key']).toBe('site-key-for-tests')
  })
})
