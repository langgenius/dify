import type { Collection } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from './index'

type ProviderLike = Pick<Collection, 'id' | 'type'> & { server_identifier?: string }

export const getProviderReference = (provider: ProviderLike) => {
  if (provider.type === CollectionType.mcp && provider.server_identifier)
    return provider.server_identifier
  return provider.id
}

export const matchesProviderReference = (provider: ProviderLike, idOrServerIdentifier?: string) => {
  if (!idOrServerIdentifier) return false
  if (provider.type === CollectionType.mcp && provider.server_identifier === idOrServerIdentifier)
    return true
  return canFindTool(provider.id, idOrServerIdentifier)
}
