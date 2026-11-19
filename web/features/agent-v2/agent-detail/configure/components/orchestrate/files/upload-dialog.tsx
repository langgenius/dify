'use client'

import type { AgentConfigFileItemResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { UseMutationResult } from '@tanstack/react-query'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { ORPCError } from '@orpc/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'
import { getFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { getSupportFileType } from '@/app/components/base/file-uploader/utils'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { getFileIconType } from '@/features/agent-v2/file-icon'
import { consoleClient, consoleQuery } from '@/service/console'
import { formatFileSize } from '@/utils/format'

type PendingAgentFile = {
  id: string
  file: File
}

type AgentFilesUploadResult = {
  files: AgentConfigFileItemResponse[]
  failures: { id: string; message?: string }[]
}

type AgentFilesUploadMutation = UseMutationResult<AgentFilesUploadResult, Error, PendingAgentFile[]>

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

function getServerMessage(error: unknown) {
  return error instanceof ORPCError ? error.message : undefined
}

function hasDraggedFiles(event: DragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function AgentFileDropzone({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (files: File[]) => void
}) {
  const { t } = useTranslation(['agentV2'])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragging, setDragging] = useState(false)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) onAdd(files)
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasDraggedFiles(event)) return

    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
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

    if (!disabled) onAdd(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      role="group"
      aria-label={t(($) => $['agentDetail.configure.files.upload.title'])}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
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
              disabled={disabled}
              className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden disabled:cursor-not-allowed"
              onClick={() => fileInputRef.current?.click()}
            >
              {t(($) => $['agentDetail.configure.files.upload.browse'])}
            </button>
          </div>
        </div>
        {dragging && <div className="absolute top-0 left-0 size-full" />}
      </div>
    </div>
  )
}

function AgentFileUploadPanel({ uploadFiles }: { uploadFiles: AgentFilesUploadMutation }) {
  const { t } = useTranslation(['agentV2'])
  const { t: tAppDebug } = useTranslation(['appDebug'])
  const { t: tCommon } = useTranslation(['common'])
  const { data: fileUploadConfig } = useQuery(consoleQuery.files.upload.get.queryOptions())
  const { imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit } =
    getFileSizeLimit(fileUploadConfig)
  const [pendingFiles, setPendingFiles] = useState<PendingAgentFile[]>([])
  const isUploading = uploadFiles.isPending
  const failures = uploadFiles.isError
    ? uploadFiles.variables.map(({ id }) => ({ id, message: getServerMessage(uploadFiles.error) }))
    : (uploadFiles.data?.failures ?? [])

  const getSizeLimit = (file: File) => {
    const fileType = getSupportFileType(file.name, file.type)

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

  const getSizeError = (file: File) => {
    const { fileType, sizeLimit } = getSizeLimit(file)
    if (file.size <= sizeLimit) return

    return tCommon(($) => $['fileUploader.uploadFromComputerLimit'], {
      type: fileType,
      size: formatFileSize(sizeLimit),
    })
  }

  const handleAdd = (files: File[]) => {
    setPendingFiles((current) => [...current, ...files.map((file) => ({ id: uuid(), file }))])
  }

  const handleUpload = () => {
    uploadFiles.mutate(pendingFiles, {
      onSuccess: (result) => {
        if (result.failures.length === 0) return
        setPendingFiles((current) =>
          current.filter(({ id }) => result.failures.some((failure) => failure.id === id)),
        )
      },
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['agentDetail.configure.files.upload.title'])}</DialogTitle>
        <DialogDescription>
          {t(($) => $['agentDetail.configure.files.upload.description'])}
        </DialogDescription>
        <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
      </DialogHeader>
      <DialogBody>
        <AgentFileDropzone disabled={isUploading} onAdd={handleAdd} />
        {pendingFiles.length > 0 && (
          <ul className="mt-2 space-y-2">
            {pendingFiles.map(({ id, file }) => {
              const failure = failures.find((item) => item.id === id)
              const error =
                getSizeError(file) ??
                (failure &&
                  (failure.message ?? t(($) => $['agentDetail.configure.files.upload.failed'])))

              return (
                <li
                  key={id}
                  className="flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover"
                >
                  <div className="flex items-center justify-center p-3">
                    <FileTreeIcon type={getFileIconType(file.name, file.type)} />
                  </div>
                  <div className="flex min-w-0 grow flex-col items-start gap-0.5 py-1 pr-2">
                    <span className="max-w-full min-w-0 truncate text-[12px] leading-4 font-medium text-text-secondary">
                      {file.name}
                    </span>
                    <div className="flex h-3 items-center gap-1 self-stretch text-2xs leading-3 font-medium text-text-tertiary uppercase">
                      <span>{t(($) => $['agentDetail.configure.files.upload.fileType'])}</span>
                      <span className="text-text-quaternary">·</span>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                    {error && <p className="system-xs-regular text-text-destructive">{error}</p>}
                  </div>
                  <div className="flex items-center pr-3">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <IconButton
                            aria-label={t(($) => $['agentDetail.configure.files.remove'], {
                              name: file.name,
                            })}
                            disabled={isUploading}
                            onClick={() =>
                              setPendingFiles((current) => current.filter((item) => item.id !== id))
                            }
                          >
                            <span aria-hidden className="i-ri-delete-bin-line size-4" />
                          </IconButton>
                        }
                      />
                      <TooltipContent>{tCommon(($) => $['operation.remove'])}</TooltipContent>
                    </Tooltip>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-2 system-xs-regular text-text-tertiary">
          {tAppDebug(($) => $['variableConfig.maxNumberTip'], {
            docLimit: formatFileSize(docSizeLimit),
            imgLimit: formatFileSize(imgSizeLimit),
            audioLimit: formatFileSize(audioSizeLimit),
            videoLimit: formatFileSize(videoSizeLimit),
          })}
        </p>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button disabled={isUploading} />}>
          {tCommon(($) => $['operation.cancel'])}
        </DialogClose>
        <Button
          type="button"
          variant="primary"
          disabled={
            pendingFiles.length === 0 || pendingFiles.some(({ file }) => getSizeError(file))
          }
          loading={isUploading}
          onClick={handleUpload}
        >
          {t(($) => $['agentDetail.configure.files.upload.action'])}
        </Button>
      </DialogFooter>
    </>
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
  onUploaded: (files: AgentFileNode[]) => void
}) {
  const uploadFiles = useMutation({
    mutationFn: async (pendingFiles: PendingAgentFile[]): Promise<AgentFilesUploadResult> => {
      const uploads = await Promise.allSettled(
        pendingFiles.map(({ file }) =>
          consoleClient.files.upload.post({ body: { file } }, { context: { silent: true } }),
        ),
      )
      const failures = pendingFiles.flatMap(({ id }, index) => {
        const upload = uploads[index]
        return upload?.status === 'rejected'
          ? [{ id, message: getServerMessage(upload.reason) }]
          : []
      })
      const upload_file_ids = uploads.flatMap((upload) =>
        upload.status === 'fulfilled' ? [upload.value.id] : [],
      )
      if (upload_file_ids.length === 0) return { files: [], failures }

      const body = { upload_file_ids }
      const { files } = apiContext.workflow
        ? await consoleClient.apps.byAppId.agent.config.files.batch.post(
            {
              params: { app_id: apiContext.workflow.appId },
              query: {
                node_id: apiContext.workflow.nodeId,
                draft_type: apiContext.draftType,
                version_id: apiContext.versionId,
              },
              body,
            },
            { context: { silent: true } },
          )
        : await consoleClient.agent.byAgentId.config.files.batch.post(
            {
              params: { agent_id: apiContext.agentId },
              query: {
                draft_type: apiContext.draftType,
                version_id: apiContext.versionId,
              },
              body,
            },
            { context: { silent: true } },
          )
      return { files, failures }
    },
    onSuccess: ({ files, failures }) => {
      if (files.length > 0) onUploaded(files.map(toAgentFileNode))
      if (failures.length === 0) onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && uploadFiles.isPending) details.cancel()
        else onOpenChange(nextOpen)
      }}
      disablePointerDismissal
    >
      <DialogContent backdropProps={{ forceRender: true, className: 'fixed' }}>
        <AgentFileUploadPanel uploadFiles={uploadFiles} />
      </DialogContent>
    </Dialog>
  )
}
