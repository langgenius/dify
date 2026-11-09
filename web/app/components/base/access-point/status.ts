export type AccessPointAvailability = 'available' | 'loading' | 'unavailable'
export type AccessPointStatus = 'disabled' | 'inService' | 'loading' | 'unavailable' | 'unsupported'

export function getAccessPointStatus(
  availability: AccessPointAvailability,
  enabled: boolean,
): AccessPointStatus {
  if (availability === 'loading') return 'loading'
  if (availability === 'unavailable') return 'unavailable'
  return enabled ? 'inService' : 'disabled'
}
