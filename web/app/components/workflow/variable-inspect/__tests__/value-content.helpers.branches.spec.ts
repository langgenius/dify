describe('value-content helpers branch coverage', () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should return validation errors for invalid schemas, over-deep schemas, and draft7 violations', async () => {
    const validateSchemaAgainstDraft7 = vi.fn()
    const getValidationErrorMessage = vi.fn(() => 'draft7 error')

    vi.doMock('@/app/components/workflow/nodes/llm/utils', () => ({
      checkJsonSchemaDepth: (schema: Record<string, unknown>) => schema.depth as number,
      getValidationErrorMessage,
      validateSchemaAgainstDraft7,
    }))

    vi.doMock('../utils', () => ({
      validateJSONSchema: (schema: Record<string, unknown>) => {
        if (schema.kind === 'invalid')
          return { success: false, error: new Error('schema invalid') }
        return { success: true }
      },
    }))

    const { validateInspectJsonValue } = await import('../value-content.helpers')

    expect(validateInspectJsonValue('{"kind":"invalid"}', 'object')).toMatchObject({
      success: false,
      validationError: 'schema invalid',
      parseError: null,
    })

    expect(validateInspectJsonValue('{"depth":99}', 'object')).toMatchObject({
      success: false,
      validationError: expect.stringContaining('Schema exceeds maximum depth'),
      parseError: null,
    })

    validateSchemaAgainstDraft7.mockReturnValueOnce([{ message: 'broken' }])

    expect(validateInspectJsonValue('{"depth":1}', 'object')).toMatchObject({
      success: false,
      validationError: 'draft7 error',
      parseError: null,
    })
    expect(getValidationErrorMessage).toHaveBeenCalled()
  })
})
