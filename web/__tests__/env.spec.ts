describe('env runtime transport', () => {
  const originalMarkdownFormFieldNameExtraChars
    = process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
  const originalMarkdownFormFieldNameMaxLength
    = process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('../utils/client')
    document.body.removeAttribute('data-markdown-form-field-name-extra-chars')
    document.body.removeAttribute('data-markdown-form-field-name-max-length')
    delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
    delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH
  })

  afterAll(() => {
    if (originalMarkdownFormFieldNameExtraChars === undefined) {
      delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
    }
    else {
      process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
        = originalMarkdownFormFieldNameExtraChars
    }
    if (originalMarkdownFormFieldNameMaxLength === undefined) {
      delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH
    }
    else {
      process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH
        = originalMarkdownFormFieldNameMaxLength
    }
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
    process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_MAX_LENGTH = '64'

    vi.doMock('../utils/client', () => ({
      isClient: false,
      isServer: true,
    }))

    const { getDatasetMap } = await import('../env')
    const datasetMap = getDatasetMap()

    expect(datasetMap['data-markdown-form-field-name-max-length']).toBe(64)
  })
})
