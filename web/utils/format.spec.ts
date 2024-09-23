import { formatFileSize, formatNumber, formatTime } from './format'
describe('formatNumber', () => {
  test('should correctly format integers', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })
  test('should correctly format decimals', () => {
    expect(formatNumber(1234567.89)).toBe('1,234,567.89')
  })
  test('should correctly handle string input', () => {
    expect(formatNumber('1234567')).toBe('1,234,567')
  })
  test('should correctly handle zero', () => {
    expect(formatNumber(0)).toBe(0)
  })
  test('should correctly handle negative numbers', () => {
    expect(formatNumber(-1234567)).toBe('-1,234,567')
  })
  test('should correctly handle empty input', () => {
    expect(formatNumber('')).toBe('')
  })
})
describe('formatFileSize', () => {
  test('should return the input if it is falsy', () => {
    expect(formatFileSize(0)).toBe(0)
  })
  test('should format bytes correctly', () => {
    expect(formatFileSize(500)).toBe('500.00B')
  })
  test('should format kilobytes correctly', () => {
    expect(formatFileSize(1500)).toBe('1.46KB')
  })
  test('should format megabytes correctly', () => {
    expect(formatFileSize(1500000)).toBe('1.43MB')
  })
  test('should format gigabytes correctly', () => {
    expect(formatFileSize(1500000000)).toBe('1.40GB')
  })
  test('should format terabytes correctly', () => {
    expect(formatFileSize(1500000000000)).toBe('1.36TB')
  })
  test('should format petabytes correctly', () => {
    expect(formatFileSize(1500000000000000)).toBe('1.33PB')
  })
})
describe('formatTime', () => {
  test('should return the input if it is falsy', () => {
    expect(formatTime(0)).toBe(0)
  })
  test('should format seconds correctly', () => {
    expect(formatTime(30)).toBe('30.00 sec')
  })
  test('should format minutes correctly', () => {
    expect(formatTime(90)).toBe('1.50 min')
  })
  test('should format hours correctly', () => {
    expect(formatTime(3600)).toBe('1.00 h')
  })
  test('should handle large numbers', () => {
    expect(formatTime(7200)).toBe('2.00 h')
  })
})
