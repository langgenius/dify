import { toLogFilters } from '@/app/components/app/log/log-filters'
import { toWorkflowLogFilters } from '@/app/components/app/workflow-log/log-filters'
import {
  defaultAgentLogFilters,
  toAgentLogQuery,
} from '@/features/agent-v2/agent-detail/logs/log-filters'

describe('log date filters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-30T20:15:00Z'))
  })

  afterEach(() => vi.useRealTimers())

  it('uses the account day and calendar month for Conversation and Completion', () => {
    expect(toLogFilters({ period: '1' }, 'unrestricted', 'UTC')).toEqual({
      start: '2026-11-30 00:00',
      end: '2026-11-30 23:59',
    })
    expect(toLogFilters({ period: '6' }, 'unrestricted', 'Asia/Shanghai')).toEqual({
      start: '2026-12-01 00:00',
      end: '2026-12-01 23:59',
    })
  })

  it('serializes Workflow account-day bounds as UTC across daylight saving changes', () => {
    expect(toWorkflowLogFilters({ period: '1' }, 'unrestricted', 'UTC')).toEqual({
      created_at__after: '2026-11-30T00:00:00Z',
      created_at__before: '2026-11-30T23:59:59Z',
    })
    vi.setSystemTime(new Date('2026-03-08T18:00:00Z'))
    expect(toWorkflowLogFilters({ period: '1' }, 'unrestricted', 'America/Los_Angeles')).toEqual({
      created_at__after: '2026-03-08T08:00:00Z',
      created_at__before: '2026-03-09T06:59:59Z',
    })
  })

  it('generates offset-free Agent bounds in the account timezone', () => {
    expect(toAgentLogQuery(defaultAgentLogFilters, 'UTC')).toEqual({
      start: '2026-11-23 20:15',
      end: '2026-11-30 20:16',
    })
    expect(toAgentLogQuery(defaultAgentLogFilters, 'Asia/Shanghai')).toEqual({
      start: '2026-11-24 04:15',
      end: '2026-12-01 04:16',
    })
  })

  it('includes the full selected day in the timezone of each export', () => {
    const selection = {
      period: 'custom' as const,
      customRange: { start: '2026-03-08', end: '2026-03-08' },
    }
    const timezone = 'America/Los_Angeles'
    expect(toLogFilters(selection, 'unrestricted', timezone)).toEqual({
      start: '2026-03-08 00:00',
      end: '2026-03-08 23:59',
    })
    expect(toWorkflowLogFilters(selection, 'unrestricted', timezone)).toEqual({
      created_at__after: '2026-03-08T08:00:00Z',
      created_at__before: '2026-03-09T06:59:59.999999Z',
    })
    expect(toAgentLogQuery({ ...defaultAgentLogFilters, ...selection }, timezone)).toEqual({
      start: '2026-03-08 00:00',
      end: '2026-03-09 00:00',
    })
  })

  it.each(['sandbox', 'pending'] as const)(
    'falls back to Today for a saved custom range while plan is %s',
    (plan) => {
      const selection = {
        period: 'custom',
        customRange: { start: '2026-10-01', end: '2026-11-08' },
      }
      expect(toLogFilters(selection, plan, 'Asia/Shanghai')).toEqual({
        start: '2026-12-01 00:00',
        end: '2026-12-01 23:59',
      })
    },
  )
})
