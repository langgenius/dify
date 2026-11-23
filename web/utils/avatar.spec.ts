import { avatarUrlStaleTime, getAvatarInitial, shouldRefreshAvatarUrls } from './avatar'

const avatarUrl = (issuedBefore: number, expiresAt: number) =>
  `/files/avatar/file-preview?issued_before=${issuedBefore}&expires_at=${expiresAt}&nonce=opaque&sign=sig`

describe('getAvatarInitial', () => {
  it.each([
    [' alice ', 'A'],
    ['🧑‍💻 Alex', '🧑‍💻'],
    ['𠮷田', '𠮷'],
    ['e\u0301mile', 'E\u0301'],
    ['', '?'],
    ['   ', '?'],
    [undefined, '?'],
  ])('uses the first complete grapheme of %s', (name, expected) => {
    expect(getAvatarInitial(name)).toBe(expected)
  })
})

describe('account avatar expiry', () => {
  it('uses the shortest freshness from the server-provided avatar timing', () => {
    const staleTime = avatarUrlStaleTime<{ avatars: string[] }>((data) => data.avatars)

    expect(
      staleTime({
        state: {
          data: { avatars: [avatarUrl(160, 500), avatarUrl(123, 130)] },
        },
      }),
    ).toBe(2_000)
  })

  it('preserves normal freshness for external and legacy avatar URLs', () => {
    const staleTime = avatarUrlStaleTime<{ avatars: string[] }>((data) => data.avatars)

    expect(
      staleTime({
        state: {
          data: {
            avatars: [
              'https://example.com/avatar.png?issued_before=100&expires_at=101',
              '/files/avatar/file-preview?timestamp=100&nonce=account-avatar-v2%3Aaccount-1&expires_at=102',
              avatarUrl(105, 104),
            ],
          },
        },
      }),
    ).toBe(300_000)
  })

  it('treats a URL with no remaining freshness at the window boundary as stale immediately', () => {
    expect(shouldRefreshAvatarUrls([avatarUrl(101, 101)], 100_000, 100_000)).toBe(true)
  })

  it.each([-120_000, 120_000])(
    'uses elapsed time with a browser clock offset of %d ms',
    (clockOffset) => {
      const timestamp = 1_800_000_000
      const receivedAt = (timestamp + 59) * 1000 + clockOffset
      const urls = [avatarUrl(timestamp + 60, timestamp + 300)]
      const staleTime = avatarUrlStaleTime<string[]>((data) => data)

      expect(staleTime({ state: { data: urls } })).toBe(235_000)
      expect(shouldRefreshAvatarUrls(urls, receivedAt, receivedAt + 234_999)).toBe(false)
      expect(shouldRefreshAvatarUrls(urls, receivedAt, receivedAt + 235_000)).toBe(true)
    },
  )
})
