export const resolveConsoleHumanInputFormURL = (backstageURL: string, basePath = ''): string => {
  try {
    const url = new URL(backstageURL, 'http://localhost')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return backstageURL

    const match = url.pathname.match(/(?:^|\/)form\/([^/]+)\/?$/)
    if (!match?.[1]) return backstageURL

    const token = encodeURIComponent(decodeURIComponent(match[1]))
    return `${basePath.replace(/\/$/, '')}/human-input/${token}`
  } catch {
    return backstageURL
  }
}
