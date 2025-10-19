import { downloadFile, formatFileSize, formatNumber, formatTime } from './format'

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
    expect(formatFileSize(500)).toBe('500.00 bytes')
  })
  test('should format kilobytes correctly', () => {
    expect(formatFileSize(1500)).toBe('1.46 KB')
  })
  test('should format megabytes correctly', () => {
    expect(formatFileSize(1500000)).toBe('1.43 MB')
  })
  test('should format gigabytes correctly', () => {
    expect(formatFileSize(1500000000)).toBe('1.40 GB')
  })
  test('should format terabytes correctly', () => {
    expect(formatFileSize(1500000000000)).toBe('1.36 TB')
  })
  test('should format petabytes correctly', () => {
    expect(formatFileSize(1500000000000000)).toBe('1.33 PB')
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
describe('downloadFile', () => {
  test('should create a link and trigger a download correctly', () => {
    // Mock data
    const blob = new Blob(['test content'], { type: 'text/plain' })
    const fileName = 'test-file.txt'
    const mockUrl = 'blob:mockUrl'

    // Mock URL.createObjectURL
    const createObjectURLMock = jest.fn().mockReturnValue(mockUrl)
    const revokeObjectURLMock = jest.fn()
    Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURLMock })
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURLMock })

    // Mock createElement and appendChild
    const mockLink = {
      href: '',
      download: '',
      click: jest.fn(),
      remove: jest.fn(),
    }
    const createElementMock = jest.spyOn(document, 'createElement').mockReturnValue(mockLink as any)
    const appendChildMock = jest.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
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
    jest.restoreAllMocks()
  })
})
