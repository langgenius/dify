import { realHumanInputV2FormTransport } from '../real-transport'

describe('public v2 file uploads', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['local', 'remote'] as const)(
    'uploads %s files with a v2 bearer grant',
    async (method) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ upload_token: 'hitl_v2_upload_grant', expires_at: 1900000000 }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'file-id',
              name: 'review.txt',
              mime_type: 'text/plain',
              size: 6,
              url: 'https://files.example/review.txt',
            }),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      vi.stubGlobal('fetch', fetch)
      const options = { signal: new AbortController().signal }
      const uploaded =
        method === 'local'
          ? await realHumanInputV2FormTransport.uploadLocalFile(
              'delivery-token',
              new File(['review'], 'review.txt', { type: 'text/plain' }),
              options,
            )
          : await realHumanInputV2FormTransport.uploadRemoteFile(
              'delivery-token',
              'https://example.com/review.txt',
              options,
            )

      expect(uploaded).toEqual({
        id: 'file-id',
        name: 'review.txt',
        mimeType: 'text/plain',
        size: 6,
        url: 'https://files.example/review.txt',
      })
      expect(fetch).toHaveBeenCalledTimes(2)
      const tokenRequest: Request = fetch.mock.calls[0]![0]
      const uploadRequest: Request = fetch.mock.calls[1]![0]
      expect(tokenRequest.url).toContain('/form/human-input/v2/public/delivery-token/upload-token')
      expect(uploadRequest.url).toContain('/human-input/v2/files')
      expect(uploadRequest.headers.get('Authorization')).toBe('Bearer hitl_v2_upload_grant')
      expect(fetch.mock.calls[1]![1]).toMatchObject({ credentials: 'omit', cache: 'no-store' })
      if (method === 'local') {
        const body = await uploadRequest.formData()
        const file = body.get('file')
        expect(file).toBeInstanceOf(File)
        if (file instanceof File) expect(file.name).toBe('review.txt')
      } else {
        expect(uploadRequest.url).toContain('/human-input/v2/files/remote')
        expect(await uploadRequest.json()).toEqual({ url: 'https://example.com/review.txt' })
      }
    },
  )

  it('does not upload when the form is expired', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'human_input_form_expired' }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(
      realHumanInputV2FormTransport.uploadRemoteFile('expired', 'https://example.com/file.txt'),
    ).rejects.toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
