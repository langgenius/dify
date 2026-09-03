'use client'

import type { ReactNode } from 'react'
import type { DocumentUploadFormHandle } from '../../upload/form'
import type { UploadExclusionReasonKey } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/client'
import { DocumentUploadForm } from '../../upload/form'
import { documentUploadIssue } from '../../upload/policy'
import { useKnowledgeFileSizeLimit } from '../../upload/use-file-size-limit'
import { DocumentDropOverlay } from '../list'
import { documentUploadParser } from '../query-state'
import { responseStatus } from '../request-error'
import { documentsKnowledgeSpaceIdAtom } from '../state/inputs'
import {
  denyDocumentWriteAtom,
  documentCanReadAtom,
  documentCanWriteAtom,
  documentPermissionInitializedAtom,
  ensureDocumentModelReadyAtom,
} from '../state/runtime'
import { documentBulkActionsVisibleAtom } from '../state/selection'
import { documentUploadAvailability } from '../state/upload'
import { queryKeyMatchesKnowledgeSpace } from '../tasks/recovery'
import { DocumentStagingCanceledError } from './model'
import { useDocumentUploadSession } from './use-document-upload-session'

function DocumentUploadHeader() {
  const { t } = useTranslation('knowledgeSpace')
  const canRead = useAtomValue(documentCanReadAtom)
  const canWrite = useAtomValue(documentCanWriteAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const [uploadRequest] = useQueryState('upload', documentUploadParser)
  const formOpen =
    documentUploadAvailability(canWrite, uploadAvailable).canUpload && uploadRequest === '1'

  return (
    <header>
      <h2
        id="new-knowledge-documents-title"
        className="title-xl-semi-bold leading-6 text-text-primary"
        tabIndex={-1}
      >
        {t(($) => (formOpen ? $.addDocument : $.documents))}
      </h2>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) => (formOpen ? $.uploadFilesDescription : $.documentsDescription))}
      </p>
      {canRead && !canWrite && (
        <p
          id="documents-readonly-reason"
          className="mt-2 inline-flex items-center gap-1.5 system-xs-regular text-text-warning"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-line size-3.5" />
          {t(($) => $.documentPermissionRestricted)}
        </p>
      )}
    </header>
  )
}

export function DocumentUploadSurface({ children }: { children: ReactNode }) {
  const { t } = useTranslation('knowledgeSpace')
  const queryClient = useQueryClient()
  const knowledgeSpaceId = useAtomValue(documentsKnowledgeSpaceIdAtom)
  const canWrite = useAtomValue(documentCanWriteAtom)
  const permissionInitialized = useAtomValue(documentPermissionInitializedAtom)
  const bulkActionsVisible = useAtomValue(documentBulkActionsVisibleAtom)
  const denyWrite = useSetAtom(denyDocumentWriteAtom)
  const ensureModelReady = useSetAtom(ensureDocumentModelReadyAtom)
  const fileSizeLimitMb = useKnowledgeFileSizeLimit()
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const [uploadRequest, setUploadRequest] = useQueryState('upload', documentUploadParser)
  const [formInitialFiles, setFormInitialFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const formRef = useRef<DocumentUploadFormHandle>(null)
  const fileDragDepthRef = useRef(0)
  const {
    discardAllStagedFiles,
    discardStagedFile,
    progress: stagedUploadProgress,
    resetProgress,
    stageFiles,
    uploadFiles: uploadStagedFiles,
    uploading,
  } = useDocumentUploadSession()
  const { canUpload } = documentUploadAvailability(canWrite, uploadAvailable)
  const formOpen = canUpload && uploadRequest === '1'

  const close = useCallback(() => {
    resetProgress()
    setFormInitialFiles([])
    void setUploadRequest(null)
  }, [resetProgress, setUploadRequest])

  const openUpload = useCallback(
    (files: File[] = []) => {
      fileDragDepthRef.current = 0
      setFileDragActive(false)
      resetProgress()
      setFormInitialFiles(files)
      void setUploadRequest('1')
    },
    [resetProgress, setUploadRequest],
  )

  const cancel = useCallback(() => {
    discardAllStagedFiles()
    close()
  }, [close, discardAllStagedFiles])

  useEffect(() => {
    if (!permissionInitialized || uploadRequest !== '1' || canUpload) return
    discardAllStagedFiles()
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Consume the route-owned one-shot signal after authorization resolves.
    void setUploadRequest(null)
  }, [canUpload, discardAllStagedFiles, permissionInitialized, setUploadRequest, uploadRequest])

  const formatExclusionDetails = useCallback(
    (exclusions: Array<{ filename: string; reasonKey: UploadExclusionReasonKey }>) => {
      const detailItems = exclusions.slice(0, 3).map(({ filename, reasonKey }) => {
        const reason =
          reasonKey === 'fileSize'
            ? t(($) => $['documentUploadExclusion.fileSize'], {
                size: fileSizeLimitMb,
              })
            : t(($) => $[`documentUploadExclusion.${reasonKey}`])
        return `${filename} (${reason})`
      })
      if (exclusions.length > detailItems.length)
        detailItems.push(
          t(($) => $['documentUploadExclusion.more'], {
            count: exclusions.length - detailItems.length,
          }),
        )
      return detailItems.join('; ')
    },
    [fileSizeLimitMb, t],
  )

  const uploadFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!canUpload || !files.length) return false
      const uploadableFiles: File[] = []
      const localExclusions: Array<{
        filename: string
        reasonKey: UploadExclusionReasonKey
      }> = []
      for (const file of files) {
        const issue = documentUploadIssue(file, fileSizeLimitMb)
        if (issue) localExclusions.push({ filename: file.name, reasonKey: issue })
        else uploadableFiles.push(file)
      }
      if (!uploadableFiles.length) {
        toast.error(
          t(($) => $.documentUploadRejected, {
            details: formatExclusionDetails(localExclusions),
          }),
        )
        return false
      }
      try {
        const uploaded = await uploadStagedFiles(uploadableFiles, async () => {
          if (
            (await ensureModelReady({ capability: 'ingest', intent: 'upload' })).status !== 'ready'
          )
            return false
          await stageFiles(uploadableFiles)
          return true
        })
        if (!uploaded) return false
        const exclusionDetails = formatExclusionDetails(localExclusions)
        if (localExclusions.length)
          toast.warning(
            t(($) => $.documentUploadPartial, {
              accepted: uploadableFiles.length,
              details: exclusionDetails,
              excluded: localExclusions.length,
            }),
          )
        else toast.success(t(($) => $.documentUploadStarted))
        void Promise.allSettled([
          queryClient.invalidateQueries({
            predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
          }),
          queryClient.invalidateQueries({
            predicate: (query) => queryKeyMatchesKnowledgeSpace(query.queryKey, knowledgeSpaceId),
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.key(),
          }),
        ])
        return true
      } catch (error) {
        if (responseStatus(error) === 403) {
          cancel()
          denyWrite()
        } else toast.error(t(($) => $.documentUploadFailed))
        return false
      }
    },
    [
      canUpload,
      cancel,
      ensureModelReady,
      fileSizeLimitMb,
      formatExclusionDetails,
      knowledgeSpaceId,
      denyWrite,
      queryClient,
      stageFiles,
      t,
      uploadStagedFiles,
    ],
  )

  const onFilesAdded = useCallback(
    async (files: File[]) => {
      try {
        await stageFiles(files)
      } catch (error) {
        if (error instanceof DocumentStagingCanceledError) return
        toast.error(t(($) => $.documentUploadFailed))
        throw error
      }
    },
    [stageFiles, t],
  )

  const onSubmit = useCallback(
    async (files: File[]) => {
      const uploaded = await uploadFiles(files)
      if (uploaded) close()
      return uploaded
    },
    [close, uploadFiles],
  )

  return (
    <section
      className={cn(
        'relative flex min-h-full w-full flex-col gap-4 px-6 pt-3',
        bulkActionsVisible ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]' : 'pb-6',
      )}
      onDragEnter={(event) => {
        const types = Array.from(event.dataTransfer.types ?? [])
        if (types.length && !types.includes('Files')) return
        event.preventDefault()
        if (!canUpload || uploading) return
        fileDragDepthRef.current += 1
        setFileDragActive(true)
      }}
      onDragLeave={() => {
        if (!fileDragDepthRef.current) return
        fileDragDepthRef.current -= 1
        if (!fileDragDepthRef.current) setFileDragActive(false)
      }}
      onDragOver={(event) => {
        const types = Array.from(event.dataTransfer.types ?? [])
        if (types.length && !types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = canUpload && !uploading ? 'copy' : 'none'
      }}
      onDrop={(event) => {
        const types = Array.from(event.dataTransfer.types ?? [])
        if (types.length && !types.includes('Files')) return
        event.preventDefault()
        fileDragDepthRef.current = 0
        setFileDragActive(false)
        if (!canUpload || uploading) return
        const files = [...event.dataTransfer.files]
        if (!files.length) return
        if (formOpen) formRef.current?.addFiles(files)
        else openUpload(files)
      }}
    >
      {!uploadAvailable && (
        <span id="documents-upload-unavailable" className="sr-only">
          {t(($) => $['cornerLabel.unavailable'], { ns: 'dataset' })}
        </span>
      )}
      <DocumentUploadHeader />
      {formOpen ? (
        <DocumentUploadForm
          ref={formRef}
          fileSizeLimitMb={fileSizeLimitMb}
          initialFiles={formInitialFiles}
          uploadProgress={stagedUploadProgress}
          uploading={uploading}
          onCancel={cancel}
          onFileRemoved={discardStagedFile}
          onFilesAdded={onFilesAdded}
          onSubmit={onSubmit}
        />
      ) : (
        children
      )}
      {fileDragActive && canUpload && <DocumentDropOverlay fileSizeLimitMb={fileSizeLimitMb} />}
    </section>
  )
}
