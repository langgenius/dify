import type {
  ExternalAgentConnectionResponse,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalConnectionSettings } from '../../roster/components/external-connection-verification'
import { isEqual } from 'es-toolkit'
import { asRecord } from '../model'

export type ExternalConnectionComparisonSnapshot = Pick<
  ExternalAgentConnectionResponse,
  | 'endpoint'
  | 'auth_type'
  | 'has_credential'
  | 'interface_url'
  | 'profile'
  | 'auth_check'
  | 'card'
  | 'capabilities'
>

const comparisonFields = [
  'endpoint',
  'auth_type',
  'interface_url',
  'profile',
  'has_credential',
  'auth_check',
  'card',
  'capabilities',
] as const satisfies readonly (keyof ExternalConnectionComparisonSnapshot)[]

// Match the public Agent Card projection returned by the saved connection endpoint.
const publicCardFields = [
  'name',
  'description',
  'provider',
  'version',
  'documentationUrl',
  'skills',
  'defaultInputModes',
  'defaultOutputModes',
  'supportedInterfaces',
  'capabilities',
  'iconUrl',
] as const

export function publicConnectionCard(card: unknown): ExternalAgentConnectionResponse['card'] {
  const source = asRecord(card)
  return Object.fromEntries(
    publicCardFields.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]),
  )
}

export function connectionComparisonChanges(
  draft: ExternalConnectionComparisonSnapshot,
  latest: ExternalAgentConnectionResponse,
): (keyof ExternalConnectionComparisonSnapshot)[] {
  const latestPublic = { ...latest, card: publicConnectionCard(latest.card) }
  return comparisonFields.filter((key) => !isEqual(draft[key], latestPublic[key]))
}

export function createConnectionComparisonSnapshot(
  connection: ExternalAgentConnectionResponse,
  settings: ExternalConnectionSettings,
  verification?: ExternalAgentVerificationResponse,
): ExternalConnectionComparisonSnapshot {
  return structuredClone({
    endpoint: settings.endpoint.trim(),
    auth_type: settings.authentication,
    has_credential:
      settings.authentication === 'bearer' && (settings.token !== '' || connection.has_credential),
    interface_url: verification?.interface_url ?? connection.interface_url,
    profile: connection.profile,
    auth_check: verification?.auth_check ?? connection.auth_check,
    card: publicConnectionCard(verification?.card ?? connection.card),
    capabilities: verification?.capabilities ?? connection.capabilities,
  })
}
