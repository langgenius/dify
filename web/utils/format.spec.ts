import { formatFileSize, formatNumber, formatNumberAbbreviated, formatTime } from './format'

describe('formatNumber', () => {
  it.each([
    [1234567, '1,234,567'],
    [-1234567.89, '-1,234,567.89'],
    ['8E-7', '0.0000008'],
    [1.23e-7, '0.000000123'],
  ])('formats %s without losing precision', (input, expected) => {
    expect(formatNumber(input)).toBe(expected)
  })
})

describe('formatFileSize', () => {
  it.each([
    [500, '500.00 bytes'],
    [1024, '1.00 KB'],
    [1500000, '1.43 MB'],
    [1500000000, '1.40 GB'],
  ])('formats %s bytes as %s', (input, expected) => {
    expect(formatFileSize(input)).toBe(expected)
  })
})

describe('formatTime', () => {
  it.each([
    [30, '30.00 sec'],
    [60, '1.00 min'],
    [3600, '1.00 h'],
  ])('formats %s seconds as %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected)
  })
})

describe('formatNumberAbbreviated', () => {
  it.each([
    [999, '999'],
    [1200, '1.2k'],
    [1500000, '1.5M'],
    [2300000000, '2.3B'],
  ])('abbreviates %s as %s', (input, expected) => {
    expect(formatNumberAbbreviated(input)).toBe(expected)
  })
})
