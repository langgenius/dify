import type { useWorkflowStore } from '@/app/components/workflow/store'
import { useEffect } from 'react'
import { parseSkillFileMetadata } from './utils'

type UseFileMetadataSyncProps = {
  fileTabId: string | null
  hasLoadedContent: boolean
  metadataSource: Record<string, unknown> | string | undefined
  isMetadataDirty: boolean
  storeApi: ReturnType<typeof useWorkflowStore>
}

export const useFileMetadataSync = ({
  fileTabId,
  hasLoadedContent,
  metadataSource,
  isMetadataDirty,
  storeApi,
}: UseFileMetadataSyncProps) => {
  useEffect(() => {
    if (!fileTabId || !hasLoadedContent || isMetadataDirty)
      return

    const { setFileMetadata, clearDraftMetadata } = storeApi.getState()
    setFileMetadata(fileTabId, parseSkillFileMetadata(metadataSource))
    clearDraftMetadata(fileTabId)
  }, [fileTabId, hasLoadedContent, isMetadataDirty, metadataSource, storeApi])
}
