import { describe, expect, it } from 'vite-plus/test'
import { getConsoleBaseUrl } from '../console-base-url'

describe('getConsoleBaseUrl', () => {
  it.each([
    {
      accountLoginUrl: 'https://console.example.com/signin',
      expected: 'https://console.example.com',
    },
    {
      accountLoginUrl: 'https://console.example.com/dify/signin',
      expected: 'https://console.example.com/dify',
    },
    { accountLoginUrl: '/dify/signin', expected: '/dify' },
    { accountLoginUrl: '/signin', expected: '' },
  ])('derives the Console base from $accountLoginUrl', ({ accountLoginUrl, expected }) => {
    expect(getConsoleBaseUrl(accountLoginUrl)).toBe(expected)
  })

  it.each([
    { accountLoginUrl: null },
    { accountLoginUrl: 'https://console.example.com/apps' },
    { accountLoginUrl: 'console.example.com/signin' },
    { accountLoginUrl: 'ftp://console.example.com/signin' },
  ])('returns no Console base for $accountLoginUrl', ({ accountLoginUrl }) => {
    expect(getConsoleBaseUrl(accountLoginUrl)).toBeNull()
  })
})
