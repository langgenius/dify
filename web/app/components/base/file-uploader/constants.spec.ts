import {
  AUDIO_SIZE_LIMIT,
  FILE_SIZE_LIMIT,
  FILE_URL_REGEX,
  IMG_SIZE_LIMIT,
  MAX_FILE_UPLOAD_LIMIT,
  VIDEO_SIZE_LIMIT,
} from './constants'

describe('file-uploader constants', () => {
  describe('size limit constants', () => {
    it('should set IMG_SIZE_LIMIT to 10 MB', () => {
      expect(IMG_SIZE_LIMIT).toBe(10 * 1024 * 1024)
    })

    it('should set FILE_SIZE_LIMIT to 15 MB', () => {
      expect(FILE_SIZE_LIMIT).toBe(15 * 1024 * 1024)
    })

    it('should set AUDIO_SIZE_LIMIT to 50 MB', () => {
      expect(AUDIO_SIZE_LIMIT).toBe(50 * 1024 * 1024)
    })

    it('should set VIDEO_SIZE_LIMIT to 100 MB', () => {
      expect(VIDEO_SIZE_LIMIT).toBe(100 * 1024 * 1024)
    })

    it('should set MAX_FILE_UPLOAD_LIMIT to 10', () => {
      expect(MAX_FILE_UPLOAD_LIMIT).toBe(10)
    })
  })

  describe('FILE_URL_REGEX', () => {
    it('should match http URLs', () => {
      expect(FILE_URL_REGEX.test('http://example.com')).toBe(true)
      expect(FILE_URL_REGEX.test('http://example.com/path/file.txt')).toBe(true)
    })

    it('should match https URLs', () => {
      expect(FILE_URL_REGEX.test('https://example.com')).toBe(true)
      expect(FILE_URL_REGEX.test('https://example.com/path/file.pdf')).toBe(true)
    })

    it('should match ftp URLs', () => {
      expect(FILE_URL_REGEX.test('ftp://files.example.com')).toBe(true)
      expect(FILE_URL_REGEX.test('ftp://files.example.com/data.csv')).toBe(true)
    })

    it('should reject URLs without a valid protocol', () => {
      expect(FILE_URL_REGEX.test('example.com')).toBe(false)
      expect(FILE_URL_REGEX.test('www.example.com')).toBe(false)
    })

    it('should reject empty strings', () => {
      expect(FILE_URL_REGEX.test('')).toBe(false)
    })

    it('should reject unsupported protocols', () => {
      expect(FILE_URL_REGEX.test('file:///local/path')).toBe(false)
      expect(FILE_URL_REGEX.test('ssh://host')).toBe(false)
      expect(FILE_URL_REGEX.test('data:text/plain;base64,abc')).toBe(false)
    })

    it('should reject partial protocol strings', () => {
      expect(FILE_URL_REGEX.test('http:')).toBe(false)
      expect(FILE_URL_REGEX.test('http:/')).toBe(false)
      expect(FILE_URL_REGEX.test('https:')).toBe(false)
      expect(FILE_URL_REGEX.test('ftp:')).toBe(false)
    })
  })
})
