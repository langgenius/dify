import { avatarUrlStaleTime, getAvatarInitial, shouldRefreshAvatarUrls } from './avatar'

const avatarUrl = (timestamp: number, expiresAt: number) =>
  `/files/avatar/file-preview?timestamp=${timestamp}&nonce=account-avatar-v2%3Aaccount-1&sign=sig&expires_at=${expiresAt}`

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
  it('uses the shortest avatar freshness, including the smaller window for a short lifetime', () => {
    const staleTime = avatarUrlStaleTime<{ avatars: string[] }>((data) => data.avatars)

    expect(
      staleTime({
        state: {
          data: { avatars: [avatarUrl(100, 500), avatarUrl(100, 130)] },
          dataUpdatedAt: 100_000,
        },
      }),
    ).toBe(10_000)
  })

  it('preserves normal freshness for external and legacy avatar URLs', () => {
    const staleTime = avatarUrlStaleTime<{ avatars: string[] }>((data) => data.avatars)

    expect(
      staleTime({
        state: {
          data: {
            avatars: [
              'https://example.com/avatar.png?expires_at=101',
              '/files/avatar/file-preview?nonce=account-avatar-v1%3Aaccount-1&expires_at=102',
            ],
          },
          dataUpdatedAt: 100_000,
        },
      }),
    ).toBe(300_000)
  })

  it.each([-120_000, 120_000])(
    'uses elapsed time with a browser clock offset of %d ms',
    (clockOffset) => {
      const timestamp = 1_800_000_000
      const receivedAt = (timestamp + 59) * 1000 + clockOffset
      const urls = [avatarUrl(timestamp, timestamp + 300)]
      const staleTime = avatarUrlStaleTime<string[]>((data) => data)

      expect(staleTime({ state: { data: urls, dataUpdatedAt: receivedAt } })).toBe(235_000)
      expect(shouldRefreshAvatarUrls(urls, receivedAt, receivedAt + 234_999)).toBe(false)
      expect(shouldRefreshAvatarUrls(urls, receivedAt, receivedAt + 235_000)).toBe(true)
    },
  )
})
