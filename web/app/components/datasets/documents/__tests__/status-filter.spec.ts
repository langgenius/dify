import { normalizeStatusForQuery, sanitizeStatusValue } from '../status-filter'

describe('document status normalization', () => {
  it.each([undefined, null, '', 'unknown'])(
    'defaults an absent or invalid status (%s) to all',
    (value) => {
      expect(sanitizeStatusValue(value)).toBe('all')
    },
  )

  it.each([
    'all',
    'queuing',
    'indexing',
    'paused',
    'error',
    'available',
    'enabled',
    'disabled',
    'archived',
  ])('accepts %s regardless of URL casing', (status) => {
    expect(sanitizeStatusValue(status.toUpperCase())).toBe(status)
  })

  it('resolves the legacy active URL alias', () => {
    expect(sanitizeStatusValue('Active')).toBe('available')
  })

  it.each([
    ['Enabled', 'available'],
    ['active', 'available'],
    ['disabled', 'disabled'],
    ['unknown', 'all'],
  ])('maps URL status %s to query status %s', (input, expected) => {
    expect(normalizeStatusForQuery(input)).toBe(expected)
  })
})
