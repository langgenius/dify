import { submitWebAppHumanInputForm } from '../webapp-human-input'

const mocks = vi.hoisted(() => ({ request: vi.fn(), legacySubmit: vi.fn() }))
vi.mock('../base', () => ({ request: mocks.request }))
vi.mock('../share', () => ({ submitHumanInputForm: mocks.legacySubmit }))
vi.mock('@/config', () => ({ PUBLIC_API_PREFIX: 'https://webapp.example/api' }))

const data = { action: 'approve', inputs: { ReviewNote: 'Approved', choices: ['one', 'two'] } }
const formResponse = () =>
  Response.json({
    expiration_time: 1790000000,
    resolved_form: { title: 'Review', actions: [], parts: [], legacy_form_content: 'Review' },
  })
const formNotFound = () => Response.json({ code: 'not_found' }, { status: 404 })

describe('Webapp human input submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/chat/app-code')
  })

  it('reads the V2 form then submits once with the existing passport transport', async () => {
    mocks.request.mockResolvedValueOnce(formResponse()).mockResolvedValueOnce(Response.json({}))

    await submitWebAppHumanInputForm('opaque-token', data)

    expect(mocks.legacySubmit).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledTimes(2)
    const getCall = mocks.request.mock.calls[0]
    if (!getCall) throw new Error('Expected the V2 lookup request')
    const [getUrl, , getOptions] = getCall
    expect(getUrl).toBe('https://webapp.example/api/form/human-input/v2/opaque-token')
    expect(getOptions).toMatchObject({ isPublicAPI: true, fetchCompat: true, silent: true })
    expect(getOptions.request.method).toBe('GET')
    const postCall = mocks.request.mock.calls[1]
    if (!postCall) throw new Error('Expected the V2 submission request')
    const [postUrl, , postOptions] = postCall
    expect(postUrl).toBe(getUrl)
    expect(postOptions).toMatchObject({ isPublicAPI: true, fetchCompat: true })
    expect(postOptions.request.method).toBe('POST')
    expect(await postOptions.request.json()).toEqual(data)
  })

  it('preserves V1 submission only when the V2 form lookup explicitly reports not_found', async () => {
    mocks.request.mockRejectedValueOnce(formNotFound())
    await submitWebAppHumanInputForm('legacy-token', data)
    expect(mocks.legacySubmit).toHaveBeenCalledExactlyOnceWith('legacy-token', data)
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 409, 410, 500])(
    'does not submit through V1 after a %i lookup failure',
    async (status) => {
      const error = Response.json({ code: 'not_found' }, { status })
      mocks.request.mockRejectedValueOnce(error)
      await expect(submitWebAppHumanInputForm('opaque-token', data)).rejects.toBe(error)
      expect(mocks.legacySubmit).not.toHaveBeenCalled()
      expect(mocks.request).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    new TypeError('Network unavailable'),
    new Response('Gateway route not found', { status: 404 }),
    Response.json({ code: 'route_not_found' }, { status: 404 }),
  ])('does not mistake transport or gateway failures for a V1 form', async (error) => {
    mocks.request.mockRejectedValueOnce(error)
    await expect(submitWebAppHumanInputForm('opaque-token', data)).rejects.toBe(error)
    expect(mocks.legacySubmit).not.toHaveBeenCalled()
  })

  it('never retries a failed V2 write through V1', async () => {
    const error = formNotFound()
    mocks.request.mockResolvedValueOnce(formResponse()).mockRejectedValueOnce(error)
    await expect(submitWebAppHumanInputForm('opaque-token', data)).rejects.toBe(error)
    expect(mocks.legacySubmit).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('keeps environment reads and writes in the same passport scope', async () => {
    window.history.replaceState({}, '', '/environment/chat/environment-code')
    mocks.request.mockResolvedValueOnce(formResponse()).mockResolvedValueOnce(Response.json({}))
    await submitWebAppHumanInputForm('opaque-token', data)
    expect(mocks.request.mock.calls.map(([url]) => url)).toEqual([
      'https://webapp.example/api/environment/environment-code/form/human-input/v2/opaque-token',
      'https://webapp.example/api/environment/environment-code/form/human-input/v2/opaque-token',
    ])
  })
})
