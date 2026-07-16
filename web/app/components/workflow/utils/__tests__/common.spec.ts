import { formatWorkflowRunIdentifier } from '../common'

describe('formatWorkflowRunIdentifier', () => {
  it('should return fallback text when finishedAt is undefined', () => {
    expect(formatWorkflowRunIdentifier()).toBe(' (Running)')
  })

  it('should return fallback text when finishedAt is 0', () => {
    expect(formatWorkflowRunIdentifier(0)).toBe(' (Running)')
  })

  it('should capitalize custom fallback text', () => {
    expect(formatWorkflowRunIdentifier(undefined, 'pending')).toBe(' (Pending)')
  })

  it('should format a valid timestamp', () => {
    const timestamp = 1704067200 // 2024-01-01 00:00:00 UTC
    const result = formatWorkflowRunIdentifier(timestamp)
    expect(result).toMatch(/^ \(\d{2}:\d{2}:\d{2}( [AP]M)?\)$/)
  })

  it('should handle single-char fallback text', () => {
    expect(formatWorkflowRunIdentifier(undefined, 'x')).toBe(' (X)')
  })
})
