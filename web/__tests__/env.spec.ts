describe('env runtime transport', () => {
  const originalMarkdownFormFieldNameExtraChars
    = process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doUnmock('../utils/client')
    document.body.removeAttribute('data-markdown-form-field-name-extra-chars')
    delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
  })

  afterAll(() => {
    if (originalMarkdownFormFieldNameExtraChars === undefined) {
      delete process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
    }
    else {
      process.env.NEXT_PUBLIC_MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS
        = originalMarkdownFormFieldNameExtraChars
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
})
