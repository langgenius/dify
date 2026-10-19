import { FILE_URL_REGEX } from '../constants'

describe('upload URL protocol prefix', () => {
  it.each([
    'http://example.com/file.txt',
    'https://example.com/file.pdf',
    'ftp://files.example.com/data.csv',
  ])('accepts a supported remote URL: %s', (url) => expect(FILE_URL_REGEX.test(url)).toBe(true))

  it.each([
    'example.com/file',
    '',
    'file:///local/path',
    'data:text/plain;base64,abc',
    'https:/example.com',
  ])('rejects an unsupported or incomplete prefix: %s', (url) =>
    expect(FILE_URL_REGEX.test(url)).toBe(false),
  )
})
