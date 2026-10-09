import { getPlatformFromUserAgent } from '../shortcut-platform'

describe('getPlatformFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'mac'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'mac'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14)', 'linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 'linux'],
    ['Unknown browser', null],
    ['', null],
    [null, null],
  ])('detects %s as %s', (userAgent, expected) => {
    expect(getPlatformFromUserAgent(userAgent)).toBe(expected)
  })
})
