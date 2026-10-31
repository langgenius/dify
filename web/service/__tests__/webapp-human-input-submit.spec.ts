import { createHttpError } from '../http-error'
import { submitWebAppHumanInputForm } from '../webapp-human-input'

const mocks = vi.hoisted(() => ({ request: vi.fn(), legacySubmit: vi.fn() }))
vi.mock('../base', () => ({ request: mocks.request }))
vi.mock('../share', () => ({ submitHumanInputForm: mocks.legacySubmit }))
vi.mock('@/config', () => ({ PUBLIC_API_PREFIX: 'https://webapp.example/api' }))

const data = { action: 'approve', inputs: { ReviewNote: 'Approved', choices: ['one', 'two'] } }

describe('Webapp human input submission', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.legacySubmit.mockReset()
    window.history.replaceState({}, '', '/chat/app-code')
  })

  it.each(['1', undefined] as const)(
    'submits version %s through V1 without probing V2',
    async (formVersion) => {
      const result = { result: 'success' }
      mocks.legacySubmit.mockResolvedValueOnce(result)
      mocks.request.mockRejectedValueOnce(
        createHttpError(new Response(null, { status: 404 }), { code: 'not_found' }),
      )

      await expect(submitWebAppHumanInputForm('legacy-token', data, formVersion)).resolves.toBe(
        result,
      )

      expect(mocks.legacySubmit).toHaveBeenCalledExactlyOnceWith('legacy-token', data)
      expect(mocks.request).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['/chat/app-code', 'https://webapp.example/api/form/human-input/v2/opaque-token'],
    [
      '/environment/chat/environment-code',
      'https://webapp.example/api/environment/environment-code/form/human-input/v2/opaque-token',
    ],
  ])('submits V2 once in the passport scope for %s', async (path, expectedUrl) => {
    window.history.replaceState({}, '', path)
    mocks.request.mockResolvedValueOnce(Response.json({}))

    await submitWebAppHumanInputForm('opaque-token', data, '2')

    expect(mocks.legacySubmit).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    const postCall = mocks.request.mock.calls[0]
    if (!postCall) throw new Error('Expected the V2 submission request')
    const [postUrl, , postOptions] = postCall
    expect(postUrl).toBe(expectedUrl)
    expect(postOptions).toMatchObject({ isPublicAPI: true, fetchCompat: true })
    expect(postOptions.request.url).toBe(expectedUrl)
    expect(postOptions.request.method).toBe('POST')
    expect(await postOptions.request.json()).toEqual(data)
  })

  it.each([401, 403, 404, 409, 410, 500])(
    'propagates a V2 HTTP %i error without retrying through V1',
    async (status) => {
      const error = createHttpError(new Response(null, { status }), {
        code: 'not_found',
        message: 'Form unavailable',
      })
      mocks.request.mockRejectedValueOnce(error)

      await expect(submitWebAppHumanInputForm('opaque-token', data, '2')).rejects.toBe(error)

      expect(mocks.legacySubmit).not.toHaveBeenCalled()
      expect(mocks.request).toHaveBeenCalledTimes(1)
      expect(mocks.request.mock.calls[0]?.[2].request.method).toBe('POST')
    },
  )

  it('propagates a V2 network failure without retrying through V1', async () => {
    const error = new TypeError('Network unavailable')
    mocks.request.mockRejectedValueOnce(error)

    await expect(submitWebAppHumanInputForm('opaque-token', data, '2')).rejects.toBe(error)

    expect(mocks.legacySubmit).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0]?.[2].request.method).toBe('POST')
  })
})
