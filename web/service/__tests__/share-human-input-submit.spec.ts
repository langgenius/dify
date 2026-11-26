import { submitHumanInputForm } from '../share'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof globalThis.fetch>(),
  address: vi.fn(),
}))
vi.mock('../webapp-address', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../webapp-address')>()),
  resolveWebAppAddress: mocks.address,
}))
vi.mock('../webapp-auth', () => ({
  getWebAppAccessToken: () => '',
  getWebAppPassport: () => 'test-passport',
  getOrCreateWebAppSessionId: vi.fn(),
  beginWebAppAuthorizationRecovery: vi.fn(),
  clearWebAppPassport: vi.fn(),
  completeWebAppAuthorizationRecovery: vi.fn(),
}))

const submittedRequest = () => {
  const [input, init] = mocks.fetch.mock.calls[0]!
  if (!(input instanceof Request)) throw new TypeError('Expected fetch to receive a Request')
  return new Request(input, init)
}

describe('Web App human input submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.address.mockReturnValue({ kind: 'default', code: 'app-code' })
    mocks.fetch.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', mocks.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('submits v2 forms through the passport-authenticated Web App contract', async () => {
    const body = { inputs: { note: 'Approved' }, action: 'approve' }

    await submitHumanInputForm('v2-token', body, '2')

    const request = submittedRequest()
    expect(request.url).toMatch(/\/api\/form\/human-input\/v2\/v2-token$/)
    expect(request.method).toBe('POST')
    expect(request.headers.get('X-App-Code')).toBe('app-code')
    expect(request.headers.get('X-App-Passport')).toBe('test-passport')
    expect(await request.json()).toEqual(body)
  })

  it.each([undefined, '1'] as const)(
    'preserves legacy submission for version %s',
    async (version) => {
      const body = { inputs: {}, action: 'approve' }
      await submitHumanInputForm('legacy-token', body, version)
      const request = submittedRequest()
      expect(request.url).toMatch(/\/api\/form\/human_input\/legacy-token$/)
      expect(request.method).toBe('POST')
      expect(request.headers.get('X-App-Code')).toBe('app-code')
      expect(await request.json()).toEqual(body)
      expect(mocks.fetch).toHaveBeenCalledOnce()
    },
  )

  it.each([401, 403, 404, 409, 410, 500])(
    'propagates V2 HTTP %i without retrying the legacy endpoint',
    async (status) => {
      mocks.fetch.mockResolvedValue(
        new Response(JSON.stringify({ code: 'not_found' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await expect(
        submitHumanInputForm('v2-token', { inputs: {}, action: 'approve' }, '2'),
      ).rejects.toBeDefined()
      expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(1)
      for (const [input] of mocks.fetch.mock.calls)
        expect(input instanceof Request ? input.url : String(input)).not.toMatch(
          /\/form\/human_input\//,
        )
    },
  )

  it('uses the environment app API prefix when submitting its v2 form', async () => {
    mocks.address.mockReturnValue({ kind: 'environment', code: 'environment-code' })

    const body = { inputs: { note: 'Approved' }, action: 'approve' }
    await submitHumanInputForm('v2-token', body, '2')

    const request = submittedRequest()
    expect(request.url).toMatch(
      /\/api\/environment\/environment-code\/form\/human-input\/v2\/v2-token$/,
    )
    expect(await request.json()).toEqual(body)
    expect(request.headers.get('X-App-Code')).toBe('environment-code')
    expect(request.headers.get('X-App-Passport')).toBe('test-passport')
  })
})
