'use client'

import type {
  KnowledgeFsUploadPhase,
  KnowledgeFsUploadProgress,
} from '../../upload/knowledge-fs-upload'
import type { FileScanFailure } from '@/features/file-scan/scan-failure'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRequestId } from '../../request-id'
import {
  discardKnowledgeFsStagedUpload,
  stageKnowledgeFsDocument,
  uploadKnowledgeFsDocuments,
} from '../../upload/knowledge-fs-upload'
import { documentUploadFingerprint } from '../../upload/policy'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentUploadingAtom } from '../state/upload'
import { DocumentStagingCanceledError } from './model'

/**
 * `partial` means the request finished but the malware scan rejected some files, or files that
 * were not part of this run are still waiting; the form stays open in that case.
 */
type DocumentUploadOutcome = 'canceled' | 'completed' | 'partial'

export function useDocumentUploadSession() {
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const uploadPendingRef = useRef(false)
  const uploadRequestIdsRef = useRef(new Map<string, string>())
  const stagedUploadIdsRef = useRef(new Map<File, string>())
  const stagingPromisesRef = useRef(new Map<File, Promise<string>>())
  const stagingControllersRef = useRef(new Map<File, AbortController>())
  const uploading = useAtomValue(documentUploadingAtom)
  const setUploading = useSetAtom(documentUploadingAtom)
  const [uploadProgress] = useState<KnowledgeFsUploadProgress>(() => new Map())
  const [progress, setProgress] = useState<ReadonlyMap<File, KnowledgeFsUploadPhase>>(
    () => new Map(),
  )
  const failuresRef = useRef(new Map<File, FileScanFailure>())
  const [failures, setFailures] = useState<ReadonlyMap<File, FileScanFailure>>(() => new Map())
  const publishFailures = useCallback(() => setFailures(new Map(failuresRef.current)), [])

  const stageFiles = useCallback(
    async (files: File[], prepare?: (isActive: () => boolean) => Promise<boolean>) => {
      const controllers: AbortController[] = []
      const prepared = prepare?.(() => controllers.some((controller) => !controller.signal.aborted))
      const tasks = files.map((file) => {
        const stagedUploadId = stagedUploadIdsRef.current.get(file)
        if (stagedUploadId) return Promise.resolve(stagedUploadId)
        const active = stagingPromisesRef.current.get(file)
        if (active) return active

        const controller = new AbortController()
        controllers.push(controller)
        let settled = false
        const promise = new Promise<string>((resolve, reject) => {
          function cleanup() {
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
          function stage() {
            if (controller.signal.aborted) return
            void stageKnowledgeFsDocument(file, controller.signal).then((uploadId) => {
              if (settled) {
                void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
                return
              }
              settled = true
              cleanup()
              stagedUploadIdsRef.current.set(file, uploadId)
              resolve(uploadId)
            }, rejectOnce)
          }
          if (prepared)
            void prepared.then((allowed) => {
              if (allowed) stage()
              else rejectOnce(new DocumentStagingCanceledError())
            }, rejectOnce)
          else stage()
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
    },
    [],
  )

  const discardStagedFile = useCallback(
    (file: File) => {
      stagingControllersRef.current.get(file)?.abort(new DocumentStagingCanceledError())
      const uploadId = stagedUploadIdsRef.current.get(file)
      stagedUploadIdsRef.current.delete(file)
      if (failuresRef.current.delete(file)) {
        // Selecting the same file again must start a new claim instead of repeating the rejection.
        const fingerprint = `${knowledgeSpaceId}:${documentUploadFingerprint(file)}`
        const requestId = uploadRequestIdsRef.current.get(fingerprint)
        if (requestId) uploadProgress.delete(requestId)
        uploadRequestIdsRef.current.delete(fingerprint)
        publishFailures()
      }
      if (uploadId) void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
    },
    [knowledgeSpaceId, publishFailures, uploadProgress],
  )

  const discardStagedUploadObjects = useCallback(() => {
    const uploadIds = [...stagedUploadIdsRef.current.values()]
    for (const controller of stagingControllersRef.current.values())
      controller.abort(new DocumentStagingCanceledError())
    stagingControllersRef.current.clear()
    stagingPromisesRef.current.clear()
    stagedUploadIdsRef.current.clear()
    failuresRef.current.clear()
    uploadProgress.clear()
    uploadRequestIdsRef.current.clear()
    for (const uploadId of uploadIds)
      void discardKnowledgeFsStagedUpload(uploadId).catch(() => undefined)
  }, [uploadProgress])

  const discardAllStagedFiles = useCallback(() => {
    discardStagedUploadObjects()
    setProgress(new Map())
    publishFailures()
  }, [discardStagedUploadObjects, publishFailures])

  useEffect(() => discardStagedUploadObjects, [discardStagedUploadObjects])

  const uploadFiles = useCallback(
    async (files: File[], prepare: () => Promise<boolean>): Promise<DocumentUploadOutcome> => {
      if (uploadPendingRef.current) return 'canceled'
      uploadPendingRef.current = true
      setUploading(true)
      try {
        if (!(await prepare())) return 'canceled'
        const uploads = files.map((file) => {
          const fingerprint = `${knowledgeSpaceId}:${documentUploadFingerprint(file)}`
          const id = uploadRequestIdsRef.current.get(fingerprint) ?? createRequestId()
          uploadRequestIdsRef.current.set(fingerprint, id)
          const uploadId = stagedUploadIdsRef.current.get(file)
          if (!uploadId) throw new Error('KnowledgeFS file was not staged')
          return { file, id, uploadId }
        })
        const result = await uploadKnowledgeFsDocuments(
          knowledgeSpaceId,
          uploads,
          uploadProgress,
          (file: File, phase: KnowledgeFsUploadPhase) => {
            setProgress((current) => {
              const next = new Map(current)
              next.set(file, phase)
              return next
            })
          },
        )
        for (const { file } of uploads) failuresRef.current.delete(file)
        for (const { failure, upload } of result.failures)
          failuresRef.current.set(upload.file, failure)
        publishFailures()
        // A single-file retry must not end the session while other files still need attention.
        const everyStagedFileCompleted = [...stagedUploadIdsRef.current.keys()].every((file) => {
          const fingerprint = `${knowledgeSpaceId}:${documentUploadFingerprint(file)}`
          const requestId = uploadRequestIdsRef.current.get(fingerprint)
          return requestId !== undefined && uploadProgress.get(requestId)?.phase === 'completed'
        })
        if (failuresRef.current.size || !everyStagedFileCompleted) return 'partial'
        uploadProgress.clear()
        uploadRequestIdsRef.current.clear()
        stagedUploadIdsRef.current.clear()
        setProgress(new Map())
        return 'completed'
      } finally {
        uploadPendingRef.current = false
        setUploading(false)
        setProgress(
          (current) =>
            new Map(
              [...current].filter(([, phase]) => phase === 'completed' || phase === 'failed'),
            ),
        )
      }
    },
    [knowledgeSpaceId, publishFailures, setUploading, uploadProgress],
  )

  const resetProgress = useCallback(() => {
    setProgress(new Map())
    failuresRef.current.clear()
    publishFailures()
  }, [publishFailures])
  const completedUploadCount = useCallback(
    (files: File[]) =>
      files.filter((file) => {
        const fingerprint = `${knowledgeSpaceId}:${documentUploadFingerprint(file)}`
        const id = uploadRequestIdsRef.current.get(fingerprint)
        return id !== undefined && uploadProgress.get(id)?.phase === 'completed'
      }).length,
    [knowledgeSpaceId, uploadProgress],
  )

  return {
    completedUploadCount,
    discardAllStagedFiles,
    discardStagedFile,
    failures,
    progress,
    resetProgress,
    stageFiles,
    uploadFiles,
    uploading,
  }
}
