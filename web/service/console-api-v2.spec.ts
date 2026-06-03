import { describe, expect, it } from 'vitest'
import { consoleApiV2Prefix, consoleApiV2PrefixFrom } from './console-api-v2'

describe('consoleApiV2Prefix', () => {
  // Covers the console API migration prefix used by selected key-path helpers.
  it('should map the legacy console API prefix to the FastAPI v2 prefix', () => {
    expect(consoleApiV2Prefix()).toBe('http://localhost:5001/api/v2')
  })

  it('should derive v2 from configured console API prefixes', () => {
    expect(consoleApiV2PrefixFrom('https://console.example.com/console/api')).toBe(
      'https://console.example.com/api/v2',
    )
    expect(consoleApiV2PrefixFrom('https://console.example.com/console/api/')).toBe(
      'https://console.example.com/api/v2',
    )
  })

  it('should append v2 when the configured prefix is already the API root', () => {
    expect(consoleApiV2PrefixFrom('https://console.example.com/api')).toBe('https://console.example.com/api/v2')
  })

  it('should leave a configured v2 prefix unchanged', () => {
    expect(consoleApiV2PrefixFrom('https://console.example.com/api/v2/')).toBe('https://console.example.com/api/v2')
  })
})
