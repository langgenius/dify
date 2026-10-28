'use client'

import type { AgentConfigFileItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { DialogChangeEventDetails } from '@langgenius/dify-ui/dialog'
import type { ChangeEvent, DragEvent } from 'react'
import type { AgentConfigApiContext } from '../config-context'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FileTreeIcon } from '@langgenius/dify-ui/file-tree'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { getSupportFileType } from '@/app/components/base/file-uploader/utils'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { agentConfigFileUploadSyncAtom } from '@/features/agent-v2/agent-composer/config-file-upload-sync'
import { getFileIconType } from '@/features/agent-v2/file-icon'
import { consoleQuery } from '@/service/console'
import { formatFileSize } from '@/utils/format'

function toAgentFileNode(committedFile: AgentConfigFileItemResponse): AgentFileNode {
  return {
    id: committedFile.name,
    name: committedFile.name,
    icon: getFileIconType(committedFile.name, committedFile.mime_type),
    fileId: committedFile.file_id ?? undefined,
    configName: committedFile.name,
    size: committedFile.size ?? undefined,
    hash: committedFile.hash ?? undefined,
    mimeType: committedFile.mime_type ?? undefined,
  }
}

function hasDraggedFiles(event: DragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

type UploadQueueItem = {
  id: number
  file: File
  status: 'queued' | 'uploading' | 'binding' | 'success' | 'failed'
  uploadFileId?: string
  error?: string
  validationError?: string
}

function AgentFileUploader({
  files,
  disabled,
  onAdd,
  onRemove,
  onRetry,
}: {
  files: UploadQueueItem[]
  disabled: boolean
  onAdd: (files: { file: File; validationError?: string }[]) => void
  onRemove: (id: number) => void
  onRetry: (file: UploadQueueItem) => void
}) {
  const { t } = useTranslation(['agentV2'])
  const { t: tAppDebug } = useTranslation(['appDebug'])
  const { t: tCommon } = useTranslation(['common'])
  const { data: fileUploadConfig, isPending: isLoadingUploadConfig } = useQuery(
    consoleQuery.files.upload.get.queryOptions(),
  )
  const selectionDisabled = disabled || isLoadingUploadConfig
  const { imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit } =
    getFileSizeLimit(fileUploadConfig)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragging, setDragging] = useState(false)

  const getSizeLimit = (uploadFile: File) => {
    const fileType = getSupportFileType(uploadFile.name, uploadFile.type)

    switch (fileType) {
      case SupportUploadFileTypes.image:
        return { fileType, sizeLimit: imgSizeLimit }
      case SupportUploadFileTypes.audio:
        return { fileType, sizeLimit: audioSizeLimit }
      case SupportUploadFileTypes.video:
        return { fileType, sizeLimit: videoSizeLimit }
      default:
        return {
          fileType: SupportUploadFileTypes.document,
          sizeLimit: docSizeLimit,
        }
    }
  }

  const setUploadFiles = (selectedFiles: File[]) => {
    if (selectionDisabled) return

    onAdd(
      selectedFiles.map((file) => {
        const { fileType, sizeLimit } = getSizeLimit(file)
        return {
          file,
          validationError:
            file.size > sizeLimit
              ? tCommon(($) => $['fileUploader.uploadFromComputerLimit'], {
                  type: fileType,
                  size: formatFileSize(sizeLimit),
                })
              : undefined,
        }
      }),
    )
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setUploadFiles(files)
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (selectionDisabled || !hasDraggedFiles(event)) return

    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = selectionDisabled ? 'none' : 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return

    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return

    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setDragging(false)

    setUploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      role="group"
      aria-label={t(($) => $['agentDetail.configure.files.upload.title'])}
      aria-busy={isLoadingUploadConfig}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        aria-label={t(($) => $['agentDetail.configure.files.upload.browse'])}
        className="hidden"
        type="file"
        multiple
        disabled={selectionDisabled}
        onChange={handleFileChange}
      />
      <div
        className={cn(
          'relative flex h-16 items-center rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg text-sm font-normal',
          dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
      >
        <div className="flex w-full items-center justify-center space-x-2">
          <span aria-hidden className="i-ri-upload-cloud-2-line size-6 text-text-tertiary" />
          <div className="text-text-tertiary">
            {t(($) => $['agentDetail.configure.files.upload.dropzone'])}
            <button
              type="button"
              disabled={selectionDisabled}
              className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
            >
              {t(($) => $['agentDetail.configure.files.upload.browse'])}
            </button>
          </div>
        </div>
        {dragging && <div className="absolute top-0 left-0 size-full" />}
      </div>
      {isLoadingUploadConfig && (
        <p role="status" className="mt-2 system-xs-regular text-text-tertiary">
          {tCommon(($) => $.loading)}
        </p>
      )}
      <ul className="mt-2 space-y-2" aria-live="polite" aria-relevant="additions text">
        {files.map((item) => {
          const statusLabel = {
            queued: t(($) => $['agentDetail.configure.files.upload.queued']),
            uploading: t(($) => $['agentDetail.configure.files.upload.uploading']),
            binding: t(($) => $['agentDetail.configure.files.upload.binding']),
            success: t(($) => $['agentDetail.configure.files.upload.success']),
            failed: t(($) => $['agentDetail.configure.files.upload.failed']),
          }[item.status]
          const error = item.validationError ?? item.error

          return (
            <li
              key={item.id}
              className="flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs"
            >
              <div className="flex items-center justify-center p-3">
                <FileTreeIcon type={getFileIconType(item.file.name, item.file.type)} />
              </div>
              <div className="flex min-w-0 grow flex-col items-start gap-0.5 py-2 pr-2">
                <span className="max-w-full min-w-0 text-xs leading-4 font-medium wrap-anywhere text-text-secondary">
                  {item.file.name}
                </span>
                <div className="flex items-center gap-1 text-2xs leading-3 font-medium text-text-tertiary">
                  <span>{formatFileSize(item.file.size)}</span>
                  <span aria-hidden className="text-text-quaternary">
                    ·
                  </span>
                  <span
                    className={cn(
                      item.status === 'failed' && 'text-text-destructive',
                      item.status === 'success' && 'text-text-success',
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>
                {error && error !== statusLabel && (
                  <p className="system-xs-regular wrap-anywhere text-text-destructive">{error}</p>
                )}
              </div>
              <div className="flex items-center gap-1 pr-3">
                {item.status === 'failed' && !item.validationError && (
                  <Button
                    type="button"
                    size="small"
                    disabled={disabled}
                    onClick={() => onRetry(item)}
                  >
                    {tCommon(($) => $['operation.retry'])}
                  </Button>
                )}
                {item.status !== 'success' && (
                  <IconButton
                    aria-label={t(($) => $['agentDetail.configure.files.remove'], {
                      name: item.file.name,
                    })}
                    disabled={disabled}
                    onClick={() => onRemove(item.id)}
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
                  </IconButton>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 system-xs-regular text-text-tertiary">
        {tAppDebug(($) => $['variableConfig.maxNumberTip'], {
          docLimit: formatFileSize(docSizeLimit),
          imgLimit: formatFileSize(imgSizeLimit),
          audioLimit: formatFileSize(audioSizeLimit),
          videoLimit: formatFileSize(videoSizeLimit),
        })}
      </p>
    </div>
  )
}

export function AgentFileUploadDialog({
  apiContext,
  open,
  onOpenChange,
  onUploaded,
}: {
  apiContext: AgentConfigApiContext
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (file: AgentFileNode) => void
}) {
  const { t } = useTranslation(['agentV2', 'common'])
  const { t: tCommon } = useTranslation(['common'])
  const [files, setFiles] = useState<UploadQueueItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const isUploadingRef = useRef(false)
  const nextFileIdRef = useRef(0)
  const fileUploadSync = useAtomValue(agentConfigFileUploadSyncAtom)
  const uploadFileMutation = useMutation(
    consoleQuery.files.upload.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const commitAgentFileMutation = useMutation(
    consoleQuery.agent.byAgentId.config.files.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const commitWorkflowAgentFileMutation = useMutation(
    consoleQuery.apps.byAppId.agent.config.files.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const pendingFiles = files.filter(
    (item) => !item.validationError && (item.status === 'queued' || item.status === 'failed'),
  )

  const handleOpenChange = (nextOpen: boolean, details?: DialogChangeEventDetails) => {
    if (!nextOpen && isUploadingRef.current) {
      details?.cancel()
      return
    }
    onOpenChange(nextOpen)
  }

  const handleAddFiles = (selectedFiles: { file: File; validationError?: string }[]) => {
    if (isUploadingRef.current) return

    const queuedFiles: UploadQueueItem[] = selectedFiles.map(({ file, validationError }) => ({
      id: nextFileIdRef.current++,
      file,
      status: validationError ? 'failed' : 'queued',
      validationError,
    }))
    setFiles((current) => [...current, ...queuedFiles])
  }

  const handleRemoveFile = (id: number) => {
    if (isUploadingRef.current) return
    setFiles((current) => current.filter((item) => item.id !== id))
  }

  const handleUpload = async (selectedFiles: UploadQueueItem[]) => {
    if (isUploadingRef.current || selectedFiles.length === 0) return

    isUploadingRef.current = true
    setIsUploading(true)
    let updatedFiles = files
    const updateFile = (id: number, update: Partial<UploadQueueItem>) => {
      updatedFiles = updatedFiles.map((item) => (item.id === id ? { ...item, ...update } : item))
      setFiles(updatedFiles)
    }

    const releaseAutosave = await fileUploadSync.beginUpload()
    try {
      // Both upload and binding are sequential: binding writes the whole Agent config snapshot.
      for (const item of selectedFiles) {
        let uploadFileId = item.uploadFileId
        if (!uploadFileId) {
          updateFile(item.id, { status: 'uploading', error: undefined })
          try {
            const uploadedFile = await uploadFileMutation.mutateAsync({ body: { file: item.file } })
            uploadFileId = uploadedFile.id
            updateFile(item.id, { uploadFileId })
          } catch (error) {
            updateFile(item.id, {
              status: 'failed',
              error:
                error instanceof Error
                  ? error.message
                  : t(($) => $['agentDetail.configure.files.upload.failed']),
            })
            continue
          }
        }

        updateFile(item.id, { status: 'binding', error: undefined })
        try {
          const body = { upload_file_id: uploadFileId }
          const committedFile = apiContext.workflow
            ? await commitWorkflowAgentFileMutation.mutateAsync({
                params: { app_id: apiContext.workflow.appId },
                query: {
                  node_id: apiContext.workflow.nodeId,
                  draft_type: apiContext.draftType,
                  version_id: apiContext.versionId,
                },
                body,
              })
            : await commitAgentFileMutation.mutateAsync({
                params: { agent_id: apiContext.agentId },
                query: {
                  draft_type: apiContext.draftType,
                  version_id: apiContext.versionId,
                },
                body,
              })
          updateFile(item.id, { status: 'success' })
          onUploaded(toAgentFileNode(committedFile.file))
        } catch (error) {
          updateFile(item.id, {
            status: 'failed',
            error:
              error instanceof Error
                ? error.message
                : t(($) => $['agentDetail.configure.files.upload.bindingFailed']),
          })
        }
      }
    } finally {
      await releaseAutosave()
      isUploadingRef.current = false
      setIsUploading(false)
    }

    if (updatedFiles.every((item) => item.status === 'success')) handleOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setFiles([])
      }}
      disablePointerDismissal
    >
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void handleUpload(pendingFiles)
          }}
        >
          <DialogHeader>
            <DialogTitle>{t(($) => $['agentDetail.configure.files.upload.title'])}</DialogTitle>
            <DialogDescription>
              {t(($) => $['agentDetail.configure.files.upload.description'])}
            </DialogDescription>
            <DialogHeaderCloseButton
              disabled={isUploading}
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <AgentFileUploader
              files={files}
              disabled={isUploading}
              onAdd={handleAddFiles}
              onRemove={handleRemoveFile}
              onRetry={(item) => {
                void handleUpload([item])
              }}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" disabled={isUploading} />}>
              {tCommon(($) => $['operation.cancel'])}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!files.some((item) => !item.validationError && item.status !== 'success')}
              loading={isUploading}
            >
              {t(($) => $['agentDetail.configure.files.upload.action'])}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
