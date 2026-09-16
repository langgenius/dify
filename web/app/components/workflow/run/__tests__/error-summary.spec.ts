import { summarizeWorkflowError } from '../error-summary'

describe('summarizeWorkflowError', () => {
  it('returns empty string for missing errors', () => {
    expect(summarizeWorkflowError(undefined)).toBe('')
    expect(summarizeWorkflowError(null)).toBe('')
    expect(summarizeWorkflowError('   ')).toBe('')
  })

  it('keeps short single-line errors unchanged', () => {
    expect(summarizeWorkflowError('Model rate limit exceeded')).toBe('Model rate limit exceeded')
  })

  it('uses the first non-empty line for multi-line errors', () => {
    const error = ['Traceback (most recent call last):', '  File "app.py", line 1', 'ValueError: bad'].join('\n')
    expect(summarizeWorkflowError(error)).toBe('Traceback (most recent call last):')
  })

  it('truncates very long first lines with an ellipsis', () => {
    const error = 'x'.repeat(250)
    const summary = summarizeWorkflowError(error, 50)
    expect(summary).toHaveLength(50)
    expect(summary.endsWith('…')).toBe(true)
  })
})
