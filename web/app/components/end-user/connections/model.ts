import type {
  ConsumerConnectionProviderResponse,
  ConsumerConnectionResponse,
} from '@dify/contracts/api/web/types.gen'

export type ConnectionProvider = Pick<ConsumerConnectionProviderResponse, 'provider'> &
  Partial<Pick<ConsumerConnectionProviderResponse, 'icon' | 'icon_dark'>>

export type EndUserConnection = ConsumerConnectionResponse
