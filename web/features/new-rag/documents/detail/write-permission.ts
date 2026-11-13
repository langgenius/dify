'use client'

import { useCallback } from 'react'
import { useKnowledgeSpace } from '../../space/context'

export type RefreshDocumentWritePermission = () => Promise<boolean>

export function useRefreshDocumentWritePermission(): RefreshDocumentWritePermission {
  const { refetch } = useKnowledgeSpace()

  return useCallback(async () => {
    const space = await refetch()
    return Boolean(space?.permission_keys.includes('knowledge_space_document_write'))
  }, [refetch])
}
