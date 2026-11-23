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

  it('uses both account midnight and the offset at each Workflow boundary', () => {
    expect(toWorkflowLogFilters({ period: '1' }, 'unrestricted', 'UTC')).toEqual({
      created_at__after: '2026-11-30T00:00:00+00:00',
      created_at__before: '2026-11-30T23:59:59+00:00',
    })
    vi.setSystemTime(new Date('2026-03-08T18:00:00Z'))
    expect(toWorkflowLogFilters({ period: '1' }, 'unrestricted', 'America/Los_Angeles')).toEqual({
      created_at__after: '2026-03-08T00:00:00-08:00',
      created_at__before: '2026-03-08T23:59:59-07:00',
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
})
