import {
  getAppRunsQuota,
  getCountQuota,
  getLicenseQuota,
  getTriggerEventsQuota,
  getVectorSpaceQuota,
  isQuotaReached,
} from '../quota'

describe('billing quotas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 7, 12))
  })
  afterEach(() => vi.useRealTimers())

  const inSevenDays = new Date(2026, 8, 14).getTime() / 1000

  it('keeps null as unlimited and zero as zero capacity', () => {
    expect(getCountQuota({ size: 3, limit: null })).toEqual({ usage: 3, limit: null })
    expect(getCountQuota({ size: 3, limit: 0 })).toEqual({ usage: 3, limit: 0 })
    expect(getVectorSpaceQuota({ size: 3, limit: null })).toEqual({ usage: 3, limit: null })
    expect(getAppRunsQuota({ usage: 9, limit: null, reset_date: -1 }, 'sandbox')).toEqual({
      usage: 9,
      limit: null,
    })
  })

  it('translates the license convention of zero for unlimited', () => {
    expect(getLicenseQuota({ enabled: true, size: 3, limit: 0 })).toEqual({ usage: 3, limit: null })
    expect(getLicenseQuota({ enabled: true, size: 3, limit: 5 })).toEqual({ usage: 3, limit: 5 })
  })

  it.each([
    { name: 'unlimited', quota: { usage: 100, limit: null }, reached: false },
    { name: 'zero capacity', quota: { usage: 0, limit: 0 }, reached: true },
    { name: 'below the limit', quota: { usage: 4, limit: 5 }, reached: false },
    { name: 'exactly at the limit', quota: { usage: 5, limit: 5 }, reached: true },
    { name: 'over the limit', quota: { usage: 6, limit: 5 }, reached: true },
  ])('reports whether the quota is reached when $name', ({ quota, reached }) => {
    expect(isQuotaReached(quota)).toBe(reached)
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
