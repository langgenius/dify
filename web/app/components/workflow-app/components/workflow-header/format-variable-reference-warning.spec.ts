import { describe, expect, it } from 'vite-plus/test'
import {
  formatVariableReferenceWarningPairs,
  MAX_REPORTED_VARIABLE_REFERENCE_ISSUES,
} from './format-variable-reference-warning'

const issue = (nodeTitle: string, referencedTitle: string) => ({
  node_id: nodeTitle,
  node_title: nodeTitle,
  referenced_node_id: referencedTitle,
  referenced_node_title: referencedTitle,
})

describe('formatVariableReferenceWarningPairs', () => {
  it('joins consumer and producer titles for the toast', () => {
    expect(formatVariableReferenceWarningPairs([issue('Consumer', 'Producer')], () => '+1 more')).toBe(
      '"Consumer" ← "Producer"',
    )
  })

  it('caps the listed pairs and appends the overflow label', () => {
    const issues = Array.from({ length: MAX_REPORTED_VARIABLE_REFERENCE_ISSUES + 2 }, (_, index) =>
      issue(`C${index}`, `P${index}`),
    )
    const pairs = formatVariableReferenceWarningPairs(issues, (overflow) => `+${overflow} more`)
    expect(pairs.endsWith('; +2 more')).toBe(true)
    expect(pairs.split('; "').length).toBe(MAX_REPORTED_VARIABLE_REFERENCE_ISSUES)
  })
})
