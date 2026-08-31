'use client'

import type { KnowledgeFsUploadPhase, KnowledgeFsUploadProgress } from '../../knowledge-fs-upload'
import { useCallback, useEffect, useRef, useState } from 'react'
import { discardKnowledgeFsStagedUpload, stageKnowledgeFsDocument } from '../../knowledge-fs-upload'
import { createRequestId } from '../../request-id'
import {
  DOCUMENT_STAGING_REQUEST_TIMEOUT,
  DocumentStagingCanceledError,
  DocumentStagingTimeoutError,
} from './model'

export function useDocumentUploadSession(knowledgeSpaceId: string) {
  const uploadPendingRef = useRef(false)
  const uploadRequestIdsRef = useRef(new Map<string, string>())
  const stagedUploadIdsRef = useRef(new Map<File, string>())
  const stagingPromisesRef = useRef(new Map<File, Promise<string>>())
  const stagingControllersRef = useRef(new Map<File, AbortController>())
  const [uploading, setUploading] = useState(false)
  const [uploadProgress] = useState<KnowledgeFsUploadProgress>(() => new Map())
  const [progress, setProgress] = useState<ReadonlyMap<File, KnowledgeFsUploadPhase>>(
    () => new Map(),
  )

  const stageFiles = useCallback(async (files: File[]) => {
    const tasks = files.map((file) => {
      const stagedUploadId = stagedUploadIdsRef.current.get(file)
      if (stagedUploadId) return Promise.resolve(stagedUploadId)
      const active = stagingPromisesRef.current.get(file)
      if (active) return active

      const controller = new AbortController()
      let settled = false
      let timeout: number | undefined
      const promise = new Promise<string>((resolve, reject) => {
        function cleanup() {
          if (timeout !== undefined) window.clearTimeout(timeout)
          controller.signal.removeEventListener('abort', handleAbort)
          if (stagingControllersRef.current.get(file) === controller) {
            stagingPromisesRef.current.delete(file)
            stagingControllersRef.current.delete(file)
          }
        }
        function rejectOnce(error: unknown) {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
        function handleAbort() {
          rejectOnce(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new DocumentStagingCanceledError(),
          )
        }
        controller.signal.addEventListener('abort', handleAbort, { once: true })
        timeout = window.setTimeout(
          () => controller.abort(new DocumentStagingTimeoutError()),
          DOCUMENT_STAGING_REQUEST_TIMEOUT,
        )
        void stageKnowledgeFsDocument(file, controller.signal).then(
          (uploadId) => {
            if (settled) {
              void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
              return
            }
            settled = true
            cleanup()
            stagedUploadIdsRef.current.set(file, uploadId)
            resolve(uploadId)
          },
          (error) => {
            rejectOnce(error)
          },
        )
      })
      stagingPromisesRef.current.set(file, promise)
      stagingControllersRef.current.set(file, controller)
      return promise
    })
    if (!tasks.length) return

    const results = await Promise.allSettled(tasks)
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    const failed =
      failures.find(({ reason }) => !(reason instanceof DocumentStagingCanceledError)) ??
      failures[0]
    if (failed) throw failed.reason
  }, [])

  const discardStagedFile = useCallback((file: File) => {
    stagingControllersRef.current.get(file)?.abort(new DocumentStagingCanceledError())
    const uploadId = stagedUploadIdsRef.current.get(file)
    stagedUploadIdsRef.current.delete(file)
    if (uploadId) void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
  }, [])

  const discardStagedUploadObjects = useCallback(() => {
    const uploadIds = [...stagedUploadIdsRef.current.values()]
    for (const controller of stagingControllersRef.current.values())
      controller.abort(new DocumentStagingCanceledError())
    stagingControllersRef.current.clear()
    stagingPromisesRef.current.clear()
    stagedUploadIdsRef.current.clear()
    uploadProgress.clear()
    uploadRequestIdsRef.current.clear()
    for (const uploadId of uploadIds)
      void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
  }, [uploadProgress])

  const discardAllStagedFiles = useCallback(() => {
    discardStagedUploadObjects()
    setProgress(new Map())
  }, [discardStagedUploadObjects])

  useEffect(() => discardStagedUploadObjects, [discardStagedUploadObjects])

  const beginUpload = useCallback(() => {
    if (uploadPendingRef.current) return false
    uploadPendingRef.current = true
    setUploading(true)
    return true
  }, [])

  const endUpload = useCallback(() => {
    uploadPendingRef.current = false
    setUploading(false)
    setProgress(new Map())
  }, [])

  const prepareUploads = useCallback(
    (files: File[]) =>
      files.map((file) => {
        const fingerprint = `${knowledgeSpaceId}:${file.name}:${file.size}:${file.lastModified}`
        const id = uploadRequestIdsRef.current.get(fingerprint) ?? createRequestId()
        uploadRequestIdsRef.current.set(fingerprint, id)
        const uploadId = stagedUploadIdsRef.current.get(file)
        if (!uploadId) throw new Error('KnowledgeFS file was not staged')
        return { file, id, uploadId }
      }),
    [knowledgeSpaceId],
  )

  const updateProgress = useCallback((file: File, phase: KnowledgeFsUploadPhase) => {
    setProgress((current) => {
      const next = new Map(current)
      next.set(file, phase)
      return next
    })
  }, [])

  const completeUploads = useCallback(() => {
    uploadProgress.clear()
    uploadRequestIdsRef.current.clear()
    stagedUploadIdsRef.current.clear()
  }, [uploadProgress])

  const resetProgress = useCallback(() => setProgress(new Map()), [])

  return {
    beginUpload,
    completeUploads,
    discardAllStagedFiles,
    discardStagedFile,
    endUpload,
    prepareUploads,
    progress,
    resetProgress,
    stageFiles,
    updateProgress,
    uploading,
    uploadProgress,
  }
}
