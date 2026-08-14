import { parsePluginErrorMessage, parsePluginErrorString } from '../error-parser'

describe('parsePluginErrorString', () => {
  it('extracts the inner message from a PluginInvokeError envelope', () => {
    const raw =
      'req_id: a7ce6eaf14 PluginInvokeError: {"args":{},"error_type":"ToolProviderCredentialValidationError","message":"Invalid Apify API Token. Please check the token and try again."}'
    expect(parsePluginErrorString(raw)).toBe(
      'Invalid Apify API Token. Please check the token and try again.',
    )
  })

  it('falls back to error_type when the envelope has no message', () => {
    const raw = 'req_id: abc PluginInvokeError: {"args":{},"error_type":"ToolProviderError"}'
    expect(parsePluginErrorString(raw)).toBe('ToolProviderError')
  })

  it('returns the input unchanged when it is not a plugin envelope', () => {
    expect(parsePluginErrorString('plain error message')).toBe('plain error message')
  })

  it('returns the input unchanged when the envelope JSON is malformed', () => {
    const raw = 'req_id: abc PluginInvokeError: {not-json'
    expect(parsePluginErrorString(raw)).toBe(raw)
  })
})

describe('parsePluginErrorMessage', () => {
  it('parses the envelope from an error-like object', async () => {
    const error = {
      message:
        'req_id: a7ce6eaf14 PluginInvokeError: {"args":{},"error_type":"ToolProviderCredentialValidationError","message":"Bad credentials"}',
    }
    await expect(parsePluginErrorMessage(error)).resolves.toBe('Bad credentials')
  })

  it('parses the envelope from a Response body message', async () => {
    const response = new Response(
      JSON.stringify({
        message:
          'req_id: a7ce6eaf14 PluginInvokeError: {"args":{},"error_type":"ToolProviderCredentialValidationError","message":"Bad credentials"}',
      }),
      { status: 400 },
    )
    await expect(parsePluginErrorMessage(response)).resolves.toBe('Bad credentials')
  })

  it('returns plain messages unchanged', async () => {
    await expect(parsePluginErrorMessage(new Error('boom'))).resolves.toBe('boom')
  })
})
