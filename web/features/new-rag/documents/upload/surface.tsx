'use client'

import type { ReactNode, RefObject } from 'react'
import type { DocumentUploadFormHandle } from '../../upload/form'
import type { UploadExclusionReasonKey } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { KnowledgeModelSetupDialog } from '../../components/knowledge-model-setup-dialog'
import { DocumentUploadForm } from '../../upload/form'
import { uploadKnowledgeFsDocuments } from '../../upload/knowledge-fs-upload'
import { documentUploadIssue } from '../../upload/policy'
import { useKnowledgeFileSizeLimit } from '../../upload/use-file-size-limit'
import { useKnowledgeModelSetupGuard } from '../../use-knowledge-model-setup-guard'
import { DocumentDropOverlay } from '../list'
import { documentUploadParser } from '../query-state'
import { responseStatus } from '../request-error'
import { DocumentStagingCanceledError } from './model'
import { useDocumentUploadSession } from './use-document-upload-session'

export type DocumentUploadPermission = {
  canRead: boolean
  canWrite: boolean
  denyWrite: () => void
}

export type DocumentUploadTrigger = {
  canUpload: boolean
  openUpload: (files?: File[]) => void
  readOnlyReasonId?: string
  uploadRestrictionReasonId?: string
  uploading: boolean
}

type DocumentUploadSurfaceContextValue = DocumentUploadTrigger & {
  canRead: boolean
  canWrite: boolean
  fileSizeLimitMb: number
  formInitialFiles: File[]
  formOpen: boolean
  formRef: RefObject<DocumentUploadFormHandle | null>
  onCancel: () => void
  onFileRemoved: (file: File) => void
  onFilesAdded: (files: File[]) => Promise<void>
  onSubmit: (files: File[]) => Promise<boolean>
  stagedUploadProgress: ReturnType<typeof useDocumentUploadSession>['progress']
  uploadAvailable: boolean
}

const DocumentUploadSurfaceContext = createContext<DocumentUploadSurfaceContextValue | undefined>(
  undefined,
)

function useDocumentUploadSurface() {
  const value = use(DocumentUploadSurfaceContext)
  if (!value)
    throw new Error('Document upload components must be used within DocumentUploadSurface')
  return value
}

export function DocumentUploadSurface({
  bulkActionsVisible,
  children,
  knowledgeSpaceId,
  onUploadStarted,
  permission,
}: {
  bulkActionsVisible: boolean
  children: ReactNode
  knowledgeSpaceId: string
  onUploadStarted: () => void
  permission: DocumentUploadPermission
}) {
  const { t } = useTranslation('dataset')
  const { canRead, canWrite, denyWrite } = permission
  const fileSizeLimitMb = useKnowledgeFileSizeLimit()
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const [uploadRequest, setUploadRequest] = useQueryState('upload', documentUploadParser)
  const [formInitialFiles, setFormInitialFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const formRef = useRef<DocumentUploadFormHandle>(null)
  const fileDragDepthRef = useRef(0)
  const {
    beginUpload,
    completeUploads,
    discardAllStagedFiles,
    discardStagedFile,
    endUpload,
    prepareUploads,
    progress: stagedUploadProgress,
    resetProgress,
    stageFiles,
    updateProgress,
    uploading,
    uploadProgress,
  } = useDocumentUploadSession(knowledgeSpaceId)
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)

  const canUpload = canWrite && uploadAvailable
  const formOpen = canUpload && uploadRequest === '1'
  const readOnlyReasonId = canWrite ? undefined : 'documents-readonly-reason'
  const uploadRestrictionReasonId = !uploadAvailable
    ? 'documents-upload-unavailable'
    : readOnlyReasonId

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
    if (uploadRequest !== '1' || canUpload) return
    discardAllStagedFiles()
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Consume the route-owned one-shot signal after authorization resolves.
    void setUploadRequest(null)
  }, [canUpload, discardAllStagedFiles, setUploadRequest, uploadRequest])

  const formatExclusionDetails = useCallback(
    (exclusions: Array<{ filename: string; reasonKey: UploadExclusionReasonKey }>) => {
      const detailItems = exclusions.slice(0, 3).map(({ filename, reasonKey }) => {
        const reason =
          reasonKey === 'fileSize'
            ? t(($) => $['newKnowledge.documentUploadExclusion.fileSize'], {
                size: fileSizeLimitMb,
              })
            : t(($) => $[`newKnowledge.documentUploadExclusion.${reasonKey}`])
        return `${filename} (${reason})`
      })
      if (exclusions.length > detailItems.length)
        detailItems.push(
          t(($) => $['newKnowledge.documentUploadExclusion.more'], {
            count: exclusions.length - detailItems.length,
          }),
        )
      return detailItems.join('; ')
    },
    [fileSizeLimitMb, t],
  )

  const uploadFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (!canUpload || !files.length || !beginUpload()) return false
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
          t(($) => $['newKnowledge.documentUploadRejected'], {
            details: formatExclusionDetails(localExclusions),
          }),
        )
        endUpload()
        return false
      }
      try {
        if ((await ensureModelReady({ capability: 'ingest', intent: 'upload' })).status !== 'ready')
          return false
        await stageFiles(uploadableFiles)
        const uploads = prepareUploads(uploadableFiles)
        await uploadKnowledgeFsDocuments(knowledgeSpaceId, uploads, uploadProgress, updateProgress)
        completeUploads()
        const exclusionDetails = formatExclusionDetails(localExclusions)
        if (localExclusions.length)
          toast.warning(
            t(($) => $['newKnowledge.documentUploadPartial'], {
              accepted: uploadableFiles.length,
              details: exclusionDetails,
              excluded: localExclusions.length,
            }),
          )
        else toast.success(t(($) => $['newKnowledge.documentUploadStarted']))
        onUploadStarted()
        return true
      } catch (error) {
        if (responseStatus(error) === 403) {
          cancel()
          denyWrite()
        } else toast.error(t(($) => $['newKnowledge.documentUploadFailed']))
        return false
      } finally {
        endUpload()
      }
    },
    [
      beginUpload,
      canUpload,
      cancel,
      completeUploads,
      endUpload,
      ensureModelReady,
      fileSizeLimitMb,
      formatExclusionDetails,
      knowledgeSpaceId,
      onUploadStarted,
      denyWrite,
      prepareUploads,
      stageFiles,
      t,
      updateProgress,
      uploadProgress,
    ],
  )

  const onFilesAdded = useCallback(
    async (files: File[]) => {
      try {
        await stageFiles(files)
      } catch (error) {
        if (error instanceof DocumentStagingCanceledError) return
        toast.error(t(($) => $['newKnowledge.documentUploadFailed']))
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

  const trigger = useMemo<DocumentUploadTrigger>(
    () => ({
      canUpload,
      openUpload,
      readOnlyReasonId,
      uploadRestrictionReasonId,
      uploading,
    }),
    [canUpload, openUpload, readOnlyReasonId, uploadRestrictionReasonId, uploading],
  )
  const context = useMemo<DocumentUploadSurfaceContextValue>(
    () => ({
      ...trigger,
      canRead,
      canWrite,
      fileSizeLimitMb,
      formInitialFiles,
      formOpen,
      formRef,
      onCancel: cancel,
      onFileRemoved: discardStagedFile,
      onFilesAdded,
      onSubmit,
      stagedUploadProgress,
      uploadAvailable,
    }),
    [
      cancel,
      discardStagedFile,
      fileSizeLimitMb,
      formInitialFiles,
      formOpen,
      onFilesAdded,
      onSubmit,
      canRead,
      canWrite,
      stagedUploadProgress,
      trigger,
      uploadAvailable,
    ],
  )

  return (
    <DocumentUploadSurfaceContext value={context}>
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
            {t(($) => $['cornerLabel.unavailable'])}
          </span>
        )}
        {children}
        {fileDragActive && canUpload && <DocumentDropOverlay fileSizeLimitMb={fileSizeLimitMb} />}
      </section>
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        readiness={modelReadiness}
        onConfigure={configureModelSetup}
        onOpenChange={setModelSetupDialogOpen}
      />
    </DocumentUploadSurfaceContext>
  )
}

export function DocumentUploadHeader() {
  const { canRead, canWrite, formOpen } = useDocumentUploadSurface()
  const { t } = useTranslation('dataset')

  return (
    <header>
      <h2
        id="new-knowledge-documents-title"
        className="title-xl-semi-bold leading-6 text-text-primary"
        tabIndex={-1}
      >
        {t(($) => (formOpen ? $['newKnowledge.addDocument'] : $['newKnowledge.documents']))}
      </h2>
      <p className="mt-1 system-xs-regular text-text-tertiary">
        {t(($) =>
          formOpen
            ? $['newKnowledge.uploadFilesDescription']
            : $['newKnowledge.documentsDescription'],
        )}
      </p>
      {canRead && !canWrite && (
        <p
          id="documents-readonly-reason"
          className="mt-2 inline-flex items-center gap-1.5 system-xs-regular text-text-warning"
          role="status"
        >
          <span aria-hidden className="i-ri-lock-line size-3.5" />
          {t(($) => $['newKnowledge.documentPermissionRestricted'])}
        </p>
      )}
    </header>
  )
}

export function DocumentUploadContent({
  children,
}: {
  children: (trigger: DocumentUploadTrigger) => ReactNode
}) {
  const context = useDocumentUploadSurface()
  if (!context.formOpen) return children(context)
  return (
    <DocumentUploadForm
      ref={context.formRef}
      fileSizeLimitMb={context.fileSizeLimitMb}
      initialFiles={context.formInitialFiles}
      uploadProgress={context.stagedUploadProgress}
      uploading={context.uploading}
      onCancel={context.onCancel}
      onFileRemoved={context.onFileRemoved}
      onFilesAdded={context.onFilesAdded}
      onSubmit={context.onSubmit}
    />
  )
}
