const request = vi.hoisted(() =>
  vi.fn<
    (
      url: string,
      init: unknown,
      options?: { isPublicAPI?: boolean; request?: Request },
    ) => Promise<Response>
  >(),
)

vi.mock('../base', () => ({
  getPublic: vi.fn(),
  request,
}))

vi.mock('../webapp-auth', () => ({
  getOrCreateWebAppSessionId: vi.fn(() => 'webapp-session-1'),
  getWebAppAccessToken: vi.fn(),
}))

const sentRequest = (index = 0) => {
  const [url, , options] = request.mock.calls[index]!
  return { url, options, request: options!.request! }
}

describe('audioToText', () => {
  beforeEach(() => {
    request.mockReset().mockImplementation(async () => Response.json({ text: 'transcript' }))
  })

  // Each chat owner maps to one concrete backend route instead of route-param guessing.
  describe('Endpoint mapping', () => {
    it.each([
      ['installed app', 'installedApp', '/console/api/installed-apps/app-1/audio-to-text'],
      ['trial app', 'tryApp', '/console/api/trial-apps/app-1/audio-to-text'],
    ] as const)('should upload to the %s endpoint', async (_label, source, expectedPath) => {
      const { AppSourceType, audioToText } = await import('../share')
      const file = new File(['audio'], 'recording.mp3', { type: 'audio/mp3' })
      const { signal } = new AbortController()

      await expect(audioToText(AppSourceType[source], 'app-1', file, signal)).resolves.toEqual({
        text: 'transcript',
      })

      const sent = sentRequest()
      expect(new URL(sent.url).pathname).toBe(expectedPath)
      expect(sent.request.method).toBe('POST')
      expect((await sent.request.formData()).get('file')).toEqual(
        expect.objectContaining({ name: 'recording.mp3' }),
      )
      expect(sent.options?.isPublicAPI).toBeUndefined()
    })

    it('should upload to the public web app endpoint', async () => {
      const { AppSourceType, audioToText } = await import('../share')
      const file = new File(['audio'], 'recording.mp3', { type: 'audio/mp3' })

      await audioToText(AppSourceType.webApp, undefined, file)

      const sent = sentRequest()
      expect(sent.url).toBe('/audio-to-text')
      expect(sent.options?.isPublicAPI).toBe(true)
      expect((await sent.request.formData()).get('file')).toEqual(
        expect.objectContaining({ name: 'recording.mp3' }),
      )
    })
  })

  // Invalid owner context must fail locally and never hit /console/api/.
  describe('Missing context', () => {
    it('should reject an installed app request without an app ID', async () => {
      const { AppSourceType, audioToText } = await import('../share')

      expect(() =>
        audioToText(AppSourceType.installedApp, undefined, new File(['audio'], 'a.mp3')),
      ).toThrow('app ID is required')
      expect(request).not.toHaveBeenCalled()
    })
  })
})
