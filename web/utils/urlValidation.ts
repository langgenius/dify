export function validateRedirectUrl(url: string): void {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
      throw new Error('Authorization URL must be HTTP or HTTPS')
  } catch (error) {
    if (error instanceof Error && error.message === 'Authorization URL must be HTTP or HTTPS') {
      throw error
    }
    throw new Error(`Invalid URL: ${url}`)
  }
}

export function isPrivateOrLocalAddress(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true

    const ipv4Regex = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/
    const ipv4Match = ipv4Regex.exec(hostname)
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number)
      if (a === 10) return true
      if (a === 172 && b! >= 16 && b! <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
    }

    return hostname.endsWith('.local')
  } catch {
    return false
  }
}
