import { submitHumanInputForm } from '../share'

const mocks = vi.hoisted(() => ({
  legacyPost: vi.fn(),
  fetch: vi.fn<typeof globalThis.fetch>(),
  address: vi.fn(),
}))
vi.mock('../base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../base')>()),
  postPublic: mocks.legacyPost,
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
    expect(mocks.legacyPost).not.toHaveBeenCalled()
  })

  it.each([undefined, '1'] as const)(
    'preserves legacy submission for version %s',
    async (version) => {
      const body = { inputs: {}, action: 'approve' }
      await submitHumanInputForm('legacy-token', body, version)
      expect(mocks.legacyPost).toHaveBeenCalledWith('/form/human_input/legacy-token', { body })
      expect(mocks.fetch).not.toHaveBeenCalled()
    },
  )

  it('uses the environment app API prefix when submitting its v2 form', async () => {
    mocks.address.mockReturnValue({ kind: 'environment', code: 'environment-code' })

    await submitHumanInputForm('v2-token', { inputs: {}, action: 'approve' }, '2')

    const request = submittedRequest()
    expect(request.url).toMatch(
      /\/api\/environment\/environment-code\/form\/human-input\/v2\/v2-token$/,
    )
    expect(request.headers.get('X-App-Code')).toBe('environment-code')
    expect(request.headers.get('X-App-Passport')).toBe('test-passport')
  })
})
