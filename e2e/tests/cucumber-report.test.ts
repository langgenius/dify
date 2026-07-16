import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  assertCucumberReport,
  getCucumberReportGate,
  summarizeCucumberReport,
} from '../support/cucumber-report'

const step = (status: string, options: { blockedReason?: string; hidden?: boolean } = {}) => ({
  ...(options.blockedReason
    ? {
        embeddings: [
          {
            data: Buffer.from(`Blocked precondition: ${options.blockedReason}`).toString('base64'),
            mime_type: 'text/plain',
          },
        ],
      }
    : {}),
  ...(options.hidden ? { hidden: true } : {}),
  result: { status },
})

const scenario = (name: string, steps: ReturnType<typeof step>[]) => ({
  name,
  steps,
  type: 'scenario',
})

describe('summarizeCucumberReport', () => {
  it('separates passed, explicitly blocked, and unexpected skipped scenarios', () => {
    const summary = summarizeCucumberReport([
      {
        elements: [
          scenario('passes', [step('passed')]),
          scenario('blocked', [step('passed'), step('skipped', { blockedReason: 'fixture' })]),
          scenario('unexpected skip', [step('skipped')]),
        ],
        uri: 'features/example.feature',
      },
    ])

    expect(summary).toEqual({
      blockedSkipped: 1,
      failed: 0,
      other: 0,
      passed: 1,
      selected: 3,
      skipped: 2,
      unexpectedSkipped: 1,
    })
  })

  it('treats a failed hook as a failed scenario', () => {
    const summary = summarizeCucumberReport([
      {
        elements: [scenario('cleanup fails', [step('passed'), step('failed', { hidden: true })])],
        uri: 'features/example.feature',
      },
    ])

    expect(summary.failed).toBe(1)
    expect(summary.passed).toBe(0)
  })
})

describe('assertCucumberReport', () => {
  it('accepts an explicitly blocked readiness report within configured limits', () => {
    const summary = {
      blockedSkipped: 2,
      failed: 0,
      other: 0,
      passed: 3,
      selected: 5,
      skipped: 2,
      unexpectedSkipped: 0,
    }

    expect(() =>
      assertCucumberReport(summary, {
        maxSkipped: 2,
        maxUnexpectedSkipped: 0,
        minPassed: 3,
        minSelected: 5,
        profile: 'core',
      }),
    ).not.toThrow()
  })

  it('rejects zero coverage, all-skipped coverage, and unexplained skips', () => {
    const summary = {
      blockedSkipped: 1,
      failed: 0,
      other: 0,
      passed: 0,
      selected: 2,
      skipped: 2,
      unexpectedSkipped: 1,
    }

    expect(() =>
      assertCucumberReport(summary, {
        maxSkipped: 2,
        maxUnexpectedSkipped: 0,
        minPassed: 1,
        minSelected: 3,
        profile: 'external',
      }),
    ).toThrow(
      [
        'Cucumber report gate "external" failed:',
        '- selected scenarios 2 is below minimum 3',
        '- passed scenarios 0 is below minimum 1',
        '- unexpected skipped scenarios 1 exceeds maximum 0',
      ].join('\n'),
    )
  })
})

describe('getCucumberReportGate', () => {
  it('returns no gate unless a profile is configured', () => {
    expect(getCucumberReportGate({})).toBeUndefined()
  })

  it('reads configurable scenario thresholds', () => {
    expect(
      getCucumberReportGate({
        E2E_CUCUMBER_MAX_SKIPPED_SCENARIOS: '55',
        E2E_CUCUMBER_MAX_UNEXPECTED_SKIPPED_SCENARIOS: '0',
        E2E_CUCUMBER_MIN_PASSED_SCENARIOS: '60',
        E2E_CUCUMBER_MIN_SELECTED_SCENARIOS: '110',
        E2E_CUCUMBER_REPORT_PROFILE: 'core',
      }),
    ).toEqual({
      maxSkipped: 55,
      maxUnexpectedSkipped: 0,
      minPassed: 60,
      minSelected: 110,
      profile: 'core',
    })
  })

  it('rejects invalid thresholds instead of silently weakening the gate', () => {
    expect(() =>
      getCucumberReportGate({
        E2E_CUCUMBER_MIN_SELECTED_SCENARIOS: '-1',
        E2E_CUCUMBER_REPORT_PROFILE: 'core',
      }),
    ).toThrow('E2E_CUCUMBER_MIN_SELECTED_SCENARIOS must be a non-negative integer, got "-1".')
  })
})
