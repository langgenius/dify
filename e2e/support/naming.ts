export const createE2EResourceName = (resource: string, qualifier?: string) => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return ['E2E', qualifier, resource, nonce].filter(Boolean).join(' ')
}
