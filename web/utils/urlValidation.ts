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

/**
 * Check if URL is a private/local network address or cloud debug URL
 * @param url - The URL string to check
 * @returns true if the URL is a private/local address or cloud debug URL
 */
export function isPrivateOrLocalAddress(url: string): boolean {
  try {
    const urlObj = new URL(url)
    let hostname = urlObj.hostname.toLowerCase()

    // Strip IPv6 square brackets from hostname if present (e.g. "[::1]" -> "::1")
    if (hostname.startsWith('[') && hostname.endsWith(']'))
      hostname = hostname.slice(1, -1)

    // Check for localhost and loopback addresses
    if (
      hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '0:0:0:0:0:0:0:1'
      || hostname === '0:0:0:0:0:0:0:0'
      || hostname === '::'
    )
      return true

    // Check for IPv6 link-local (fe80::/10), unique local (fc00::/7, fd00::/8)
    if (
      hostname.startsWith('fe80:')
      || hostname.startsWith('fc')
      || hostname.startsWith('fd')
    )
      return true

    // Check for IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1)
    if (hostname.startsWith('::ffff:')) {
      const mappedIpv4 = hostname.slice(7)
      return isPrivateOrLocalAddress(`http://${mappedIpv4}`)
    }

    // Check for private IP ranges
    const ipv4Regex = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/
    const ipv4Match = ipv4Regex.exec(hostname)
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number)
      // 10.0.0.0/8
      if (a === 10) return true
      // 127.0.0.0/8 (loopback)
      if (a === 127) return true
      // 0.0.0.0/8
      if (a === 0) return true
      // 172.16.0.0/12
      if (a === 172 && b! >= 16 && b! <= 31) return true
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true
    }

    // Check for .local domains and localhost subdomains
    return hostname.endsWith('.local') || hostname.endsWith('.localhost')
  } catch {
    return false
  }
}
