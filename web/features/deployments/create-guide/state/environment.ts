import type { Environment } from '@dify/contracts/enterprise/types.gen'

export function environmentMatchesIdentifier(environment: Environment, identifier: string) {
  const normalizedIdentifier = identifier.trim()
  if (!normalizedIdentifier) return false

  return environment.id === normalizedIdentifier || environment.displayName === normalizedIdentifier
}
