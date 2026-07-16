import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  assertCucumberReport,
  getCucumberReportGate,
  summarizeCucumberReport,
} from '../support/cucumber-report'

const step = (status?: string, options: { blockedReason?: string; hidden?: boolean } = {}) => ({
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
  ...(status ? { result: { status } } : {}),
})

const scenario = (name: string, steps: ReturnType<typeof step>[], tags: string[] = []) => ({
  name,
  steps,
  tags: tags.map((tag) => ({ name: tag })),
  type: 'scenario',
})

describe('summarizeCucumberReport', () => {
  it('separates passed, explicitly blocked, and unexpected skipped scenarios', () => {
    const summary = summarizeCucumberReport([
      {
        elements: [
          scenario('passes', [step('passed')]),
          scenario(
            'blocked',
            [step('passed'), step('skipped', { blockedReason: 'fixture' })],
            ['@fixture'],
          ),
          scenario('unexpected skip', [step('skipped')]),
        ],
        uri: 'features/example.feature',
      },
    ])

    expect(summary).toEqual({
      blockedScenarios: [
        {
          name: 'blocked',
          tags: ['@fixture'],
          uri: 'features/example.feature',
        },
      ],
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

  it('classifies a scenario with a missing step status as unclassified', () => {
    const summary = summarizeCucumberReport([
      {
        elements: [scenario('missing status', [step('passed', { hidden: true }), step()])],
        uri: 'features/example.feature',
      },
    ])

    expect(summary.other).toBe(1)
    expect(summary.passed).toBe(0)
  })
})

describe('assertCucumberReport', () => {
  it('accepts an explicitly blocked readiness report within configured limits', () => {
    const summary = {
      blockedScenarios: [
        { name: 'fixture blocked', tags: ['@fixture'], uri: 'features/example.feature' },
        { name: 'preflight blocked', tags: ['@preflight'], uri: 'features/example.feature' },
      ],
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
        allowedBlockedTags: ['@fixture', '@preflight'],
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
      blockedScenarios: [
        { name: 'fixture blocked', tags: ['@fixture'], uri: 'features/example.feature' },
      ],
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
        allowedBlockedTags: ['@fixture'],
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

  it('rejects an explicitly blocked scenario outside the allowed dependency tags', () => {
    const summary = {
      blockedScenarios: [
        { name: 'core regression', tags: ['@core'], uri: 'features/example.feature' },
      ],
      blockedSkipped: 1,
      failed: 0,
      other: 0,
      passed: 1,
      selected: 2,
      skipped: 1,
      unexpectedSkipped: 0,
    }

    expect(() =>
      assertCucumberReport(summary, {
        allowedBlockedTags: ['@fixture'],
        maxSkipped: 1,
        maxUnexpectedSkipped: 0,
        minPassed: 1,
        minSelected: 2,
        profile: 'core',
      }),
    ).toThrow(
      'blocked scenarios without an allowed dependency tag: features/example.feature: core regression',
    )
  })
})

describe('getCucumberReportGate', () => {
  it('returns no gate unless a profile is configured', () => {
    expect(getCucumberReportGate({})).toBeUndefined()
  })

  it('returns the checked-in gate for a known profile', () => {
    expect(
      getCucumberReportGate({
        E2E_CUCUMBER_REPORT_PROFILE: 'webkit-browser-smoke',
      }),
    ).toEqual({
      allowedBlockedTags: [],
      maxSkipped: 0,
      maxUnexpectedSkipped: 0,
      minPassed: 4,
      minSelected: 4,
      profile: 'webkit-browser-smoke',
    })
  })

  it('rejects an unknown profile instead of silently weakening the gate', () => {
    expect(() =>
      getCucumberReportGate({
        E2E_CUCUMBER_REPORT_PROFILE: 'custom',
      }),
    ).toThrow('Unknown Cucumber report gate profile "custom".')
  })
})
