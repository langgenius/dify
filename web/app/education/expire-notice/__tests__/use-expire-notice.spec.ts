import { resolveEducationExpireNotice } from '../use-expire-notice'

describe('resolveEducationExpireNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats expiring and expired reminders as distinct dismissal identities', () => {
    const expireAt = Date.parse('2026-07-30T00:00:00Z') / 1000
    const dismissedNotice = {
      accountId: 'user-1',
      expireAt,
      phase: 'expiring' as const,
    }

    expect(
      resolveEducationExpireNotice({
        accountId: 'user-1',
        allowRefresh: true,
        dismissedNotice,
        expireAt,
        isLoading: false,
        userTimezone: 'UTC',
      }),
    ).toBeNull()

    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'))

    expect(
      resolveEducationExpireNotice({
        accountId: 'user-1',
        allowRefresh: true,
        dismissedNotice,
        expireAt,
        isLoading: false,
        userTimezone: 'UTC',
      }),
    ).toMatchObject({ expired: true, phase: 'expired' })
  })

  it('scopes a dismissed reminder to the account that dismissed it', () => {
    const expireAt = Date.parse('2026-08-01T00:00:00Z') / 1000

    expect(
      resolveEducationExpireNotice({
        accountId: 'user-2',
        allowRefresh: true,
        dismissedNotice: {
          accountId: 'user-1',
          expireAt,
          phase: 'expiring',
        },
        expireAt,
        isLoading: false,
        userTimezone: 'UTC',
      }),
    ).toMatchObject({ accountId: 'user-2', phase: 'expiring' })
  })
})
