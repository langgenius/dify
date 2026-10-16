import type { Collection } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from './index'

type ProviderLike = Pick<Collection, 'id' | 'type'> & { server_identifier?: string }

/**
 * The identifier to persist when a node, agent config or prompt mention points at a
 * provider. MCP providers are resolved by `server_identifier` at runtime because it
 * survives a DSL export/import into another workspace; the primary key does not.
 */
export const getProviderReference = (provider: ProviderLike) => {
  if (provider.type === CollectionType.mcp && provider.server_identifier)
    return provider.server_identifier
  return provider.id
}

/**
 * Whether a persisted reference points at this provider.
 * Use idOrServerIdentifier for backward compatibility. Previous id content could be non-deterministic,
 * we will support both primary key or server_identifier as reference
 */
export const matchesProviderReference = (provider: ProviderLike, idOrServerIdentifier?: string) => {
  if (!idOrServerIdentifier) return false
  if (provider.type === CollectionType.mcp && provider.server_identifier === idOrServerIdentifier)
    return true
  return canFindTool(provider.id, idOrServerIdentifier)
}
