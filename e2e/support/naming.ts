export const createE2EResourceName = (resource: string, qualifier?: string) => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return ['E2E', qualifier, resource, nonce].filter(Boolean).join(' ')
}

export function assertE2EResourceName(name: string, resource: string) {
  if (name.startsWith('E2E '))
    return

  throw new Error(`${resource} test resources must use an "E2E " name prefix: ${name}`)
}
