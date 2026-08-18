import { describe, expect, it } from 'vitest'
import {
  assertCucumberScenariosStarted,
  countStartedCucumberScenarios,
} from '../support/cucumber-messages'

describe('countStartedCucumberScenarios', () => {
  it('counts test case start messages', () => {
    const report = [
      JSON.stringify({ meta: { protocolVersion: '32.3.1' } }),
      JSON.stringify({ testCaseStarted: { id: 'first' } }),
      JSON.stringify({ testCaseStarted: { id: 'second' } }),
      '',
    ].join('\n')

    expect(countStartedCucumberScenarios(report)).toBe(2)
  })

  it('returns zero when the selector starts no scenarios', () => {
    const report = [
      JSON.stringify({ meta: { protocolVersion: '32.3.1' } }),
      JSON.stringify({ testRunStarted: { timestamp: {} } }),
      JSON.stringify({ testRunFinished: { timestamp: {} } }),
    ].join('\n')

    expect(countStartedCucumberScenarios(report)).toBe(0)
    expect(() => assertCucumberScenariosStarted(report)).toThrow(
      'Cucumber selected zero scenarios.',
    )
  })
})
