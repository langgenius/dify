import type {
  ConsumerConnectionProviderResponse,
  ConsumerConnectionResponse,
} from '@dify/contracts/api/web/types.gen'

export type ConnectionProvider = Pick<ConsumerConnectionProviderResponse, 'provider'> &
  Partial<Pick<ConsumerConnectionProviderResponse, 'icon' | 'icon_dark' | 'label'>>

export type EndUserConnection = ConsumerConnectionResponse

export function getConnectionProviderLabel(provider: ConnectionProvider, language: string) {
  return provider.label?.[language] || provider.label?.en_US || provider.provider
}
