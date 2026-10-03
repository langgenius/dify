/**
 * Validates that a URL is safe for redirection.
 * Only allows HTTP and HTTPS protocols to prevent XSS attacks.
 *
 * @param url - The URL string to validate
 * @throws Error if the URL has an unsafe protocol
 */
export function validateRedirectUrl(url: string): void {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
      throw new Error('Authorization URL must be HTTP or HTTPS')
  } catch (error) {
    if (error instanceof Error && error.message === 'Authorization URL must be HTTP or HTTPS') {
      throw error
    }
    // If URL parsing fails, it's also invalid
    throw new Error(`Invalid URL: ${url}`)
  }
}

const IPV4_REGEX = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/

/**
 * Check if an IPv4 dotted-quad hostname falls in a private/local range.
 */
function isPrivateIpv4(hostname: string): boolean {
  const match = IPV4_REGEX.exec(hostname)
  if (!match) return false

  const [, a, b] = match.map(Number)
  // 0.0.0.0/8 (unspecified)
  if (a === 0) return true
  // 10.0.0.0/8
  if (a === 10) return true
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12
  if (a === 172 && b! >= 16 && b! <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true

  return false
}

/**
 * Check if an IPv6 address is private/local. The address is passed without its
 * surrounding brackets, in the compressed lowercase form `URL.hostname` returns
 * (so `0:0:0:0:0:0:0:1` arrives here as `::1`).
 */
function isPrivateIpv6(address: string): boolean {
  // ::1 (loopback) and :: (unspecified)
  if (address === '::1' || address === '::') return true
  // fc00::/7 (unique local)
  if (/^f[cd]/.test(address)) return true
  // fe80::/10 (link-local)
  if (/^fe[89ab]/.test(address)) return true

  return false
}

/**
 * Check if URL is a private/local network address or cloud debug URL
 * @param url - The URL string to check
 * @returns true if the URL is a private/local address or cloud debug URL
 */
export function isPrivateOrLocalAddress(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    // Check for localhost
    if (hostname === 'localhost') return true

    // URL.hostname keeps the square brackets around IPv6 literals, e.g. `[::1]`
    if (hostname.startsWith('[') && hostname.endsWith(']'))
      return isPrivateIpv6(hostname.slice(1, -1))

    // Check for private IP ranges
    if (isPrivateIpv4(hostname)) return true

    // Check for .local domains
    return hostname.endsWith('.local')
  } catch {
    return false
  }
}
