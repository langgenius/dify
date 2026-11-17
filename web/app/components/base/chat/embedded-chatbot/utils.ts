export const isDify = () => {
  try {
    const { hostname, protocol } = new URL(document.referrer)
    return (
      (protocol === 'https:' || protocol === 'http:') &&
      (hostname === 'dify.ai' || hostname.endsWith('.dify.ai'))
    )
  } catch {
    return false
  }
}
