import { avatarUrlStaleTime, getAvatarInitial, shouldRefreshAvatarUrls } from './avatar'

const avatarUrl = (expiresAt: number) =>
  `/files/avatar/file-preview?timestamp=100&nonce=account-avatar-v2%3Aaccount-1&sign=sig&expires_at=${expiresAt}`

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
  it('caps query freshness at the soonest signed avatar expiry with a safety margin', () => {
    const staleTime = avatarUrlStaleTime<{ avatars: string[] }>((data) => data.avatars)

    expect(
      staleTime({
        state: {
          data: { avatars: [avatarUrl(500), avatarUrl(130)] },
          dataUpdatedAt: 100_000,
        },
      }),
    ).toBe(25_000)
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

  it('refreshes only when a signed account avatar reaches its margin', () => {
    expect(shouldRefreshAvatarUrls([avatarUrl(130)], 124_999)).toBe(false)
    expect(shouldRefreshAvatarUrls([avatarUrl(130)], 125_000)).toBe(true)
  })
})
