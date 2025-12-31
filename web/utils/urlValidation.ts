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
  }
  catch (error) {
    if (
      error instanceof Error
      && error.message === 'Authorization URL must be HTTP or HTTPS'
    ) {
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
    const hostname = urlObj.hostname.toLowerCase()

    // Check for localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
      return true

    // Check for private IP ranges
    const ipv4Regex = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/
    const ipv4Match = hostname.match(ipv4Regex)
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number)
      // 10.0.0.0/8
      if (a === 10)
        return true
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31)
        return true
      // 192.168.0.0/16
      if (a === 192 && b === 168)
        return true
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254)
        return true
    }

    // Check for .local domains
    return hostname.endsWith('.local')
  }
  catch {
    return false
  }
}
