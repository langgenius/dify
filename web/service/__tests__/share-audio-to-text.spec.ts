const consolePost = vi.hoisted(() => vi.fn())
const publicPost = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: (...args: unknown[]) => consolePost(...args),
  delPublic: vi.fn(),
  getPublic: vi.fn(),
  patchPublic: vi.fn(),
  postPublic: (...args: unknown[]) => publicPost(...args),
  ssePost: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('../webapp-auth', () => ({
  getWebAppAccessToken: vi.fn(),
}))

describe('audioToText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Each chat owner maps to one concrete backend route instead of route-param guessing.
  describe('Endpoint mapping', () => {
    it.each([
      ['installed app', 'installedApp', 'installed-apps/app-1/audio-to-text'],
      ['trial app', 'tryApp', 'trial-apps/app-1/audio-to-text'],
    ] as const)('should use the %s endpoint', async (_label, source, expectedUrl) => {
      const { AppSourceType, audioToText } = await import('../share')
      const formData = new FormData()

      audioToText(AppSourceType[source], 'app-1', formData)

      expect(consolePost).toHaveBeenCalledWith(
        expectedUrl,
        { body: formData },
        { bodyStringify: false, deleteContentType: true },
      )
      expect(publicPost).not.toHaveBeenCalled()
    })

    it('should use the public web app endpoint', async () => {
      const { AppSourceType, audioToText } = await import('../share')
      const formData = new FormData()

      audioToText(AppSourceType.webApp, undefined, formData)

      expect(publicPost).toHaveBeenCalledWith(
        '/audio-to-text',
        { body: formData },
        { bodyStringify: false, deleteContentType: true },
      )
      expect(consolePost).not.toHaveBeenCalled()
    })
  })

  // Invalid owner context must fail locally and never hit /console/api/.
  describe('Missing context', () => {
    it('should reject an installed app request without an app ID', async () => {
      const { AppSourceType, audioToText } = await import('../share')

      expect(() => audioToText(AppSourceType.installedApp, undefined, new FormData())).toThrow(
        'app ID is required',
      )
      expect(consolePost).not.toHaveBeenCalled()
    })
  })
})
