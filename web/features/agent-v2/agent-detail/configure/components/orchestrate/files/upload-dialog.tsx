'use client'

import type {
  AgentConfigFileItemResponse,
  AgentConfigFileUploadResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { FileResponse } from '@dify/contracts/api/console/files/types.gen'
import type { ChangeEvent, DragEvent } from 'react'
import type { AgentConfigApiContext } from '../config-context'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FileTreeIcon } from '@langgenius/dify-ui/file-tree'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { consoleQuery } from '@/service/client'
import { formatFileSize } from '@/utils/format'
import { getFileIconType } from './file-icon'

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

function AgentFileUploader({ file, onChange }: { file?: File; onChange: (file?: File) => void }) {
  const { t } = useTranslation('agentV2')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragging, setDragging] = useState(false)

  const setUploadFiles = (files: File[]) => {
    const [uploadFile] = files
    if (files.length !== 1 || !uploadFile) {
      toast.error(t(($) => $['agentDetail.configure.files.upload.invalidFile']))
      return
    }

    onChange(uploadFile)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setUploadFiles(files)
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return

    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
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
      className="mt-6"
      role="group"
      aria-label={t(($) => $['agentDetail.configure.files.upload.title'])}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input ref={fileInputRef} className="hidden" type="file" onChange={handleFileChange} />
      {!file && (
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
                className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={() => fileInputRef.current?.click()}
              >
                {t(($) => $['agentDetail.configure.files.upload.browse'])}
              </button>
            </div>
          </div>
          {dragging && <div className="absolute top-0 left-0 size-full" />}
        </div>
      )}
      {file && (
        <div className="group flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-hover">
          <div className="flex items-center justify-center p-3">
            <FileTreeIcon type={getFileIconType(file.name, file.type)} />
          </div>
          <div className="flex min-w-0 grow flex-col items-start gap-0.5 py-1 pr-2">
            <span className="max-w-full min-w-0 truncate text-[12px] leading-4 font-medium text-text-secondary">
              {file.name}
            </span>
            <div className="flex h-3 items-center gap-1 self-stretch text-[10px] leading-3 font-medium text-text-tertiary uppercase">
              <span>{t(($) => $['agentDetail.configure.files.upload.fileType'])}</span>
              <span className="text-text-quaternary">·</span>
              <span>{formatFileSize(file.size)}</span>
            </div>
          </div>
          <div className="hidden items-center pr-3 group-hover:flex">
            <ActionButton onClick={() => onChange(undefined)}>
              <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
            </ActionButton>
          </div>
        </div>
      )}
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
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [file, setFile] = useState<File>()
  const uploadFileMutation = useMutation(consoleQuery.files.upload.post.mutationOptions())
  const commitAgentFileMutation = useMutation(
    consoleQuery.agent.byAgentId.config.files.post.mutationOptions(),
  )
  const commitWorkflowAgentFileMutation = useMutation(
    consoleQuery.apps.byAppId.agent.config.files.post.mutationOptions(),
  )
  const isUploading =
    uploadFileMutation.isPending ||
    commitAgentFileMutation.isPending ||
    commitWorkflowAgentFileMutation.isPending

  const commitUploadedFile = (
    uploadedFile: FileResponse,
    options: {
      onSuccess: (committedFile: AgentConfigFileUploadResponse) => void
      onError: () => void
    },
  ) => {
    const body = {
      upload_file_id: uploadedFile.id,
    }

    if (apiContext.workflow) {
      commitWorkflowAgentFileMutation.mutate(
        {
          params: {
            app_id: apiContext.workflow.appId,
          },
          query: {
            node_id: apiContext.workflow.nodeId,
            draft_type: apiContext.draftType,
            version_id: apiContext.versionId,
          },
          body,
        },
        options,
      )
      return
    }

    commitAgentFileMutation.mutate(
      {
        params: {
          agent_id: apiContext.agentId,
        },
        query: {
          draft_type: apiContext.draftType,
          version_id: apiContext.versionId,
        },
        body,
      },
      options,
    )
  }

  const handleUpload = () => {
    if (!file || isUploading) return

    uploadFileMutation.mutate(
      {
        body: {
          file,
        },
      },
      {
        onSuccess: (uploadedFile) => {
          commitUploadedFile(uploadedFile, {
            onSuccess: (committedFile) => {
              toast.success(t(($) => $['agentDetail.configure.files.upload.success']))
              onUploaded(toAgentFileNode(committedFile.file))
              setFile(undefined)
              onOpenChange(false)
            },
            onError: () => {
              toast.error(t(($) => $['agentDetail.configure.files.upload.failed']))
            },
          })
        },
        onError: () => {
          toast.error(t(($) => $['agentDetail.configure.files.upload.failed']))
        },
      },
    )
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      uploadFileMutation.reset()
      commitAgentFileMutation.reset()
      commitWorkflowAgentFileMutation.reset()
      setFile(undefined)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent backdropProps={{ forceRender: true }} backdropClassName="fixed">
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['agentDetail.configure.files.upload.title'])}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t(($) => $['agentDetail.configure.files.upload.description'])}
        </DialogDescription>
        <AgentFileUploader file={file} onChange={setFile} />
        <div className="flex justify-end gap-2 pt-6">
          <Button type="button" onClick={() => handleOpenChange(false)} disabled={isUploading}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!file}
            loading={isUploading}
            onClick={handleUpload}
          >
            {t(($) => $['agentDetail.configure.files.upload.action'])}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
