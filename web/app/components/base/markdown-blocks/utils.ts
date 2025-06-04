export const isValidUrl = (url: string): boolean => {
  try {
    const parsed_url = new URL(url)
    return ['http:', 'https:'].includes(parsed_url.protocol)
  }
  catch {
    return false
  }
}
