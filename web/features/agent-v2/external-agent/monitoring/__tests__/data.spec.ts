import type { ExternalMonitoringResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { getMonitoringRows, getMonitoringWindow } from '../data'

describe('external monitoring data', () => {
  it('treats the calendar end as inclusive and independently resolves both DST offsets', () => {
    expect(
      getMonitoringWindow(
        { name: 'custom', query: { start: '2026-11-01 00:00', end: '2026-11-04 23:59' } },
        'America/Los_Angeles',
      ),
    ).toEqual({
      start: '2026-11-01T07:00:00.000Z',
      end: '2026-11-05T08:00:00.000Z',
      timezone: 'America/Los_Angeles',
    })
    expect(
      getMonitoringWindow(
        { name: 'custom', query: { start: '2026-03-08 00:00', end: '2026-03-08 23:59' } },
        'America/Los_Angeles',
      ),
    ).toEqual({
      start: '2026-03-08T08:00:00.000Z',
      end: '2026-03-09T07:00:00.000Z',
      timezone: 'America/Los_Angeles',
    })
  })

  it('keeps missing usage as null while preserving real zero values and converting only known coverage', () => {
    const response: ExternalMonitoringResponse = {
      summary: {
        calls: 1,
        reported_tokens: null,
        average_call_duration: null,
        token_reporting_coverage: null,
        token_reporting_numerator: 0,
        token_reporting_denominator: 1,
      },
      days: [
        {
          date: '2026-11-10',
          metrics: {
            calls: 1,
            reported_tokens: null,
            average_call_duration: null,
            token_reporting_coverage: null,
            token_reporting_numerator: 0,
            token_reporting_denominator: 1,
          },
        },
        {
          date: '2026-11-11',
          metrics: {
            calls: 2,
            reported_tokens: 0,
            average_call_duration: 0,
            token_reporting_coverage: 0,
            token_reporting_numerator: 0,
            token_reporting_denominator: 2,
          },
        },
        {
          date: '2026-11-12',
          metrics: {
            calls: 2,
            reported_tokens: 500,
            average_call_duration: 3.5,
            token_reporting_coverage: 0.5,
            token_reporting_numerator: 1,
            token_reporting_denominator: 2,
          },
        },
      ],
    }
    expect(getMonitoringRows(response)).toEqual([
      {
        date: '2026-11-10',
        calls: 1,
        reportedTokens: null,
        averageCallDuration: null,
        tokenReportingCoverage: null,
      },
      {
        date: '2026-11-11',
        calls: 2,
        reportedTokens: 0,
        averageCallDuration: 0,
        tokenReportingCoverage: 0,
      },
      {
        date: '2026-11-12',
        calls: 2,
        reportedTokens: 500,
        averageCallDuration: 3.5,
        tokenReportingCoverage: 50,
      },
    ])
  })
})
