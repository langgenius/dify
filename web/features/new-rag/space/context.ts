'use client'

import type {
  KnowledgeFsProductPermission,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { createContext, use } from 'react'

export type KnowledgeSpaceContextValue = {
  refetch: () => Promise<KnowledgeFsSpaceDetailResponse | undefined>
  space: KnowledgeFsSpaceDetailResponse
}

export const KnowledgeSpaceContext = createContext<KnowledgeSpaceContextValue | undefined>(
  undefined,
)

export function useKnowledgeSpace() {
  const value = use(KnowledgeSpaceContext)
  if (!value) throw new Error('useKnowledgeSpace must be used within KnowledgeSpaceProvider')
  return value
}

export function useKnowledgeSpacePermission(permission: KnowledgeFsProductPermission) {
  return useKnowledgeSpace().space.permission_keys.includes(permission)
}
