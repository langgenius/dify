export function extractPluginId(provider: string): string {
  const parts = provider.split('/')
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : provider
}
