export function getUrlOrigin(url?: string) {
  if (!url)
    return undefined
  try {
    return new URL(url).origin
  }
  catch {
    return url
  }
}
