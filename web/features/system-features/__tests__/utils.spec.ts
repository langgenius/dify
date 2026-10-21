import { isEvaluationEdition } from '../utils'

describe('system feature utilities', () => {
  it.each([
    ['COMMUNITY', false],
    ['ENTERPRISE', true],
    ['CLOUD', true],
  ] as const)('resolves Evaluation availability for the %s edition', (edition, expected) => {
    expect(isEvaluationEdition(edition)).toBe(expected)
  })
})
