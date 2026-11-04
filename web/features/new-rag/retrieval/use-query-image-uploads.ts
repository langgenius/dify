import type { RetrievalImageUpload } from './state/scoped'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { consoleClient } from '@/service/console'
import {
  commitRetrievalComposerUploadAtom,
  removeRetrievalComposerUploadAtom,
  retrievalActiveComposerUploadsAtom,
  startRetrievalComposerUploadsAtom,
  updateRetrievalComposerUploadAtom,
} from './state/graph'
import { retrievalComposerUploadsAtom } from './state/scoped'

/** Each file owns its progress, retry and cancellation, independent of the other uploads. */
export function useQueryImageUploads() {
  const uploads = useAtomValueRawSync(retrievalActiveComposerUploadsAtom)
  const allUploads = useAtomValueRawSync(retrievalComposerUploadsAtom)
  const start = useSetAtom(startRetrievalComposerUploadsAtom)
  const update = useSetAtom(updateRetrievalComposerUploadAtom)
  const commit = useSetAtom(commitRetrievalComposerUploadAtom)
  const remove = useSetAtom(removeRetrievalComposerUploadAtom)
  const requestsRef = useRef(new Map<string, AbortController>())

  // Synchronize network lifetimes with removal and history-selection commands.
  useEffect(() => {
    const activeIds = new Set(uploads.map((upload) => upload.id))
    for (const [id, controller] of requestsRef.current) {
      if (!activeIds.has(id)) {
        controller.abort()
        requestsRef.current.delete(id)
      }
    }
    for (const item of allUploads) {
      if (!activeIds.has(item.id)) remove(item.id)
    }
  }, [uploads, allUploads, remove])

  useEffect(() => {
    const controllers = requestsRef.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  const upload = async (item: RetrievalImageUpload) => {
    const controller = new AbortController()
    requestsRef.current.set(item.id, controller)
    update({ id: item.id, progress: 0, status: 'uploading' })
    try {
      const result = await consoleClient.files.upload.post(
        { body: { file: item.file } },
        {
          signal: controller.signal,
          context: {
            silent: true,
            onUploadProgress: (progress) => update({ id: item.id, progress }),
          },
        },
      )
      if (!controller.signal.aborted) commit({ id: item.id, uploadFileId: result.id })
    } catch {
      if (!controller.signal.aborted) update({ id: item.id, status: 'failed' })
    } finally {
      requestsRef.current.delete(item.id)
    }
  }

  return {
    add: (files: File[]) => {
      for (const item of start(files)) void upload(item)
    },
    remove,
    retry: (item: RetrievalImageUpload) => void upload(item),
  }
}
