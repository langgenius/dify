import { requestErrorMessage } from '../errors'

describe('Builder request errors', () => {
  it('reads the native response without consuming its body', async () => {
    const body = {
      code: 'conflict',
      message: 'Workflow revision changed',
      error: 'Retry after refreshing',
    }
    const response = new Response(JSON.stringify(body), { status: 409 })
    expect(await requestErrorMessage(response)).toBe(
      'HTTP 409: conflict: Workflow revision changed: Retry after refreshing',
    )
    expect(response.bodyUsed).toBe(false)
    expect(await response.json()).toEqual(body)
  })

  it.each(['', '<html>Bad gateway</html>', 'null', '{}'])(
    'keeps the HTTP status for an unusable body: %s',
    async (body) => {
      expect(await requestErrorMessage(new Response(body, { status: 502 }))).toBe('HTTP 502')
    },
  )

  it('supports structured client errors and ordinary exceptions', async () => {
    expect(await requestErrorMessage({ status: 409, data: { body: { code: 'conflict' } } })).toBe(
      'HTTP 409: conflict',
    )
    expect(await requestErrorMessage(new Error('Connection lost'))).toBe('Connection lost')
  })
})
