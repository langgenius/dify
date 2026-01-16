import { downloadFile, formatFileSize, formatNumber, formatNumberAbbreviated, formatTime } from './format'

describe('formatNumber', () => {
  it('should correctly format integers', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })
  it('should correctly format decimals', () => {
    expect(formatNumber(1234567.89)).toBe('1,234,567.89')
  })
  it('should correctly handle string input', () => {
    expect(formatNumber('1234567')).toBe('1,234,567')
  })
  it('should correctly handle zero', () => {
    expect(formatNumber(0)).toBe(0)
  })
  it('should correctly handle negative numbers', () => {
    expect(formatNumber(-1234567)).toBe('-1,234,567')
  })
  it('should correctly handle empty input', () => {
    expect(formatNumber('')).toBe('')
  })
  it('should format very small numbers without scientific notation', () => {
    expect(formatNumber(0.0000008)).toBe('0.0000008')
    expect(formatNumber(0.0000001)).toBe('0.0000001')
    expect(formatNumber(0.000001)).toBe('0.000001')
    expect(formatNumber(0.00001)).toBe('0.00001')
  })
  it('should format negative small numbers without scientific notation', () => {
    expect(formatNumber(-0.0000008)).toBe('-0.0000008')
    expect(formatNumber(-0.0000001)).toBe('-0.0000001')
  })
  it('should handle small numbers from string input', () => {
    expect(formatNumber('0.0000008')).toBe('0.0000008')
    expect(formatNumber('8E-7')).toBe('0.0000008')
    expect(formatNumber('1e-7')).toBe('0.0000001')
  })
  it('should handle small numbers with multi-digit mantissa in scientific notation', () => {
    expect(formatNumber(1.23e-7)).toBe('0.000000123')
    expect(formatNumber(1.234e-7)).toBe('0.0000001234')
    expect(formatNumber(12.34e-7)).toBe('0.000001234')
    expect(formatNumber(0.0001234)).toBe('0.0001234')
    expect(formatNumber('1.23e-7')).toBe('0.000000123')
  })
})
describe('formatFileSize', () => {
  it('should return the input if it is falsy', () => {
    expect(formatFileSize(0)).toBe(0)
  })
  it('should format bytes correctly', () => {
    expect(formatFileSize(500)).toBe('500.00 bytes')
  })
  it('should format kilobytes correctly', () => {
    expect(formatFileSize(1500)).toBe('1.46 KB')
  })
  it('should format megabytes correctly', () => {
    expect(formatFileSize(1500000)).toBe('1.43 MB')
  })
  it('should format gigabytes correctly', () => {
    expect(formatFileSize(1500000000)).toBe('1.40 GB')
  })
  it('should format terabytes correctly', () => {
    expect(formatFileSize(1500000000000)).toBe('1.36 TB')
  })
  it('should format petabytes correctly', () => {
    expect(formatFileSize(1500000000000000)).toBe('1.33 PB')
  })
})
describe('formatTime', () => {
  it('should return the input if it is falsy', () => {
    expect(formatTime(0)).toBe(0)
  })
  it('should format seconds correctly', () => {
    expect(formatTime(30)).toBe('30.00 sec')
  })
  it('should format minutes correctly', () => {
    expect(formatTime(90)).toBe('1.50 min')
  })
  it('should format hours correctly', () => {
    expect(formatTime(3600)).toBe('1.00 h')
  })
  it('should handle large numbers', () => {
    expect(formatTime(7200)).toBe('2.00 h')
  })
})
describe('downloadFile', () => {
  it('should create a link and trigger a download correctly', () => {
    // Mock data
    const blob = new Blob(['test content'], { type: 'text/plain' })
    const fileName = 'test-file.txt'
    const mockUrl = 'blob:mockUrl'

    // Mock URL.createObjectURL
    const createObjectURLMock = vi.fn().mockReturnValue(mockUrl)
    const revokeObjectURLMock = vi.fn()
    Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURLMock })
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURLMock })

    // Mock createElement and appendChild
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    }
    const createElementMock = vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any)
    const appendChildMock = vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
      return node
    })

    // Call the function
    downloadFile({ data: blob, fileName })

    // Assertions
    expect(createObjectURLMock).toHaveBeenCalledWith(blob)
    expect(createElementMock).toHaveBeenCalledWith('a')
    expect(mockLink.href).toBe(mockUrl)
    expect(mockLink.download).toBe(fileName)
    expect(appendChildMock).toHaveBeenCalledWith(mockLink)
    expect(mockLink.click).toHaveBeenCalled()
    expect(mockLink.remove).toHaveBeenCalled()
    expect(revokeObjectURLMock).toHaveBeenCalledWith(mockUrl)

    // Clean up mocks
    vi.restoreAllMocks()
  })
})

describe('formatNumberAbbreviated', () => {
  it('should return number as string when less than 1000', () => {
    expect(formatNumberAbbreviated(0)).toBe('0')
    expect(formatNumberAbbreviated(1)).toBe('1')
    expect(formatNumberAbbreviated(999)).toBe('999')
  })

  it('should format thousands with k suffix', () => {
    expect(formatNumberAbbreviated(1000)).toBe('1k')
    expect(formatNumberAbbreviated(1200)).toBe('1.2k')
    expect(formatNumberAbbreviated(1500)).toBe('1.5k')
    expect(formatNumberAbbreviated(9999)).toBe('10k')
  })

  it('should format millions with M suffix', () => {
    expect(formatNumberAbbreviated(1000000)).toBe('1M')
    expect(formatNumberAbbreviated(1500000)).toBe('1.5M')
    expect(formatNumberAbbreviated(2300000)).toBe('2.3M')
    expect(formatNumberAbbreviated(999999999)).toBe('1B')
  })

  it('should format billions with B suffix', () => {
    expect(formatNumberAbbreviated(1000000000)).toBe('1B')
    expect(formatNumberAbbreviated(1500000000)).toBe('1.5B')
    expect(formatNumberAbbreviated(2300000000)).toBe('2.3B')
  })

  it('should remove .0 from whole numbers', () => {
    expect(formatNumberAbbreviated(1000)).toBe('1k')
    expect(formatNumberAbbreviated(2000000)).toBe('2M')
    expect(formatNumberAbbreviated(3000000000)).toBe('3B')
  })

  it('should keep decimal for non-whole numbers', () => {
    expect(formatNumberAbbreviated(1100)).toBe('1.1k')
    expect(formatNumberAbbreviated(1500000)).toBe('1.5M')
    expect(formatNumberAbbreviated(2700000000)).toBe('2.7B')
  })

  it('should handle edge cases', () => {
    expect(formatNumberAbbreviated(950)).toBe('950')
    expect(formatNumberAbbreviated(1001)).toBe('1k')
    expect(formatNumberAbbreviated(999999)).toBe('1M')
  })
})

describe('formatNumber edge cases', () => {
  it('should handle very large numbers', () => {
    expect(formatNumber(1234567890123)).toBe('1,234,567,890,123')
  })

  it('should handle numbers with many decimal places', () => {
    expect(formatNumber(1234.56789)).toBe('1,234.56789')
  })

  it('should handle negative decimals', () => {
    expect(formatNumber(-1234.56)).toBe('-1,234.56')
  })

  it('should handle string with decimals', () => {
    expect(formatNumber('9876543.21')).toBe('9,876,543.21')
  })
})

describe('formatFileSize edge cases', () => {
  it('should handle exactly 1024 bytes', () => {
    expect(formatFileSize(1024)).toBe('1.00 KB')
  })

  it('should handle fractional bytes', () => {
    expect(formatFileSize(512.5)).toBe('512.50 bytes')
  })
})

describe('formatTime edge cases', () => {
  it('should handle exactly 60 seconds', () => {
    expect(formatTime(60)).toBe('1.00 min')
  })

  it('should handle exactly 3600 seconds', () => {
    expect(formatTime(3600)).toBe('1.00 h')
  })

  it('should handle fractional seconds', () => {
    expect(formatTime(45.5)).toBe('45.50 sec')
  })

  it('should handle very large durations', () => {
    expect(formatTime(86400)).toBe('24.00 h') // 24 hours
  })
})
