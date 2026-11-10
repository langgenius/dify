import type { DifyBuilderAttachmentPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import { useStore } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useFileStore } from '@/app/components/base/file-uploader/store'
import { difyBuilderDraftAtom } from '../state'

export const useDifyBuilderAttachmentDraft = () => {
  const files = useFileStore()
  const store = useStore()
  const onAttachmentsAccepted = useCallback(
    (attachments: DifyBuilderAttachmentPayload[], text?: string) => {
      const admitted = new Set(attachments.map((file) => file.upload_file_id))
      files
        .getState()
        .setFiles(files.getState().files.filter((file) => !admitted.has(file.uploadedId ?? '')))
      if (text !== undefined && store.get(difyBuilderDraftAtom).trim() === text.trim())
        store.set(difyBuilderDraftAtom, '')
    },
    [files, store],
  )
  const clearAttachmentDraft = useCallback(() => files.getState().setFiles([]), [files])
  return useMemo(
    () => ({ onAttachmentsAccepted, clearAttachmentDraft }),
    [onAttachmentsAccepted, clearAttachmentDraft],
  )
}
