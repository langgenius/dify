export function decodeConnectionProviderRouteParam(provider: string) {
  try {
    return decodeURIComponent(provider)
  } catch {
    return provider
  }
}
