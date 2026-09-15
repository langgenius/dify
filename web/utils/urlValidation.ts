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
    // URL.hostname keeps the surrounding brackets for IPv6 literals
    // (e.g. `http://[::1]:8080/x` yields `[::1]`) and is already separated
    // from the port. URL.host would include the port as `:8080` which
    // breaks string equality checks for IPv6 literals — use hostname.
    const hostname = urlObj.hostname.toLowerCase()

    // Strip the brackets an IPv6 literal carries in `hostname`.
    const bare = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname

    // Check for localhost / loopback / unspecified
    if (
      bare === 'localhost'
      || bare === '127.0.0.1'
      || bare === '::1'
      || bare === '0.0.0.0'
    ) return true

    // Check for private IPv4 ranges
    const ipv4Regex = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/
    const ipv4Match = ipv4Regex.exec(bare)
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number)
      // 127.0.0.0/8 (full IPv4 loopback)
      if (a === 127) return true
      // 10.0.0.0/8
      if (a === 10) return true
      // 172.16.0.0/12
      if (a === 172 && b! >= 16 && b! <= 31) return true
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true
    }

    // Check for private IPv6 ranges (post-bracket-stripping)
    // ::1 loopback (already covered above)
    // fc00::/7 (IPv6 unique-local: fc00:: and fd00:: ranges)
    if (bare.startsWith('fc') || bare.startsWith('fd')) return true
    // fe80::/10 (link-local)
    if (
      bare.startsWith('fe8')
      || bare.startsWith('fe9')
      || bare.startsWith('fea')
      || bare.startsWith('feb')
    ) return true

    // Check for .local domains
    return hostname.endsWith('.local')
  } catch {
    return false
  }
}
