import { getAppRunsQuota, getCountQuota, getTriggerEventsQuota } from '../quota'

describe('billing quotas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 7, 12))
  })
  afterEach(() => vi.useRealTimers())

  const inSevenDays = new Date(2026, 8, 14).getTime() / 1000

  it('treats a zero count limit as unlimited', () => {
    expect(getCountQuota({ size: 3, limit: 0 })).toEqual({ usage: 3, limit: 'unlimited' })
    expect(getCountQuota({ size: 3, limit: 5 })).toEqual({ usage: 3, limit: 5 })
  })

  it('treats -1 as unlimited and keeps zero as zero capacity for periodic quotas', () => {
    expect(getAppRunsQuota({ usage: 9, limit: -1, reset_date: -1 }, 'team')).toEqual({
      usage: 9,
      limit: 'unlimited',
    })
    expect(getTriggerEventsQuota({ usage: 0, limit: 0, reset_date: -1 }, 'sandbox')).toEqual({
      usage: 0,
      limit: 0,
    })
  })

  it('shows trigger event resets only for the Professional plan', () => {
    const quota = { usage: 1, limit: 20000, reset_date: inSevenDays }

    expect(getTriggerEventsQuota(quota, 'professional').resetInDays).toBe(7)
    expect(getTriggerEventsQuota(quota, 'sandbox').resetInDays).toBeUndefined()
  })

  it('falls back to the end of the month for Sandbox App Runs without a reset date', () => {
    expect(getAppRunsQuota({ usage: 1, limit: 5000, reset_date: inSevenDays }, 'sandbox')).toEqual({
      usage: 1,
      limit: 5000,
      resetInDays: 7,
    })
    expect(getAppRunsQuota({ usage: 1, limit: 5000, reset_date: -1 }, 'sandbox').resetInDays).toBe(
      23,
    )
    expect(
      getAppRunsQuota({ usage: 1, limit: 5000, reset_date: -1 }, 'professional').resetInDays,
    ).toBeUndefined()
  })
})
