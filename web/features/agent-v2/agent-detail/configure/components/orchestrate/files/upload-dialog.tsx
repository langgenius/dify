'use client'

import type { FileResponse } from '@dify/contracts/api/console/files/types.gen'
import type { FileTreeIconType } from '@langgenius/dify-ui/file-tree'
import type { AgentFileNode } from '@/features/agent-v2/agent-composer/form-state'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FileTreeIcon } from '@langgenius/dify-ui/file-tree'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { consoleQuery } from '@/service/client'
import { formatFileSize } from '@/utils/format'

const codeFileExtensions = new Set([
  'css',
  'go',
  'html',
  'js',
  'jsx',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'ts',
  'tsx',
  'vue',
  'yaml',
  'yml',
])
const tableFileExtensions = new Set(['csv', 'xls', 'xlsx'])
const archiveFileExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip'])

function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function getFileIconType(fileName: string, mimeType?: string | null): FileTreeIconType {
  const extension = getFileExtension(fileName)

  if (mimeType?.startsWith('image/'))
    return 'image'
  if (mimeType === 'application/pdf' || extension === 'pdf')
    return 'pdf'
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx')
    return 'markdown'
  if (extension === 'json')
    return 'json'
  if (tableFileExtensions.has(extension))
    return 'table'
  if (archiveFileExtensions.has(extension))
    return 'archive'
  if (codeFileExtensions.has(extension))
    return 'code'
  if (mimeType?.startsWith('text/'))
    return 'text'

  return 'file'
}

function toAgentFileNode(uploadedFile: FileResponse): AgentFileNode {
  return {
    id: uploadedFile.id,
    name: uploadedFile.name,
    icon: getFileIconType(uploadedFile.name, uploadedFile.mime_type),
  }
}

function AgentFileUploader({
  file,
  onChange,
}: {
  file?: File
  onChange: (file?: File) => void
}) {
  const { t } = useTranslation('agentV2')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const setUploadFiles = (files: File[]) => {
    const [uploadFile] = files
    if (files.length !== 1 || !uploadFile) {
      toast.error(t('agentDetail.configure.files.upload.invalidFile'))
      return
    }

    onChange(uploadFile)
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setUploadFiles(files)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)

    setUploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="mt-6">
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        onChange={handleFileChange}
      />
      {!file && (
        <div
          className={cn(
            'relative flex h-16 items-center rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg text-sm font-normal',
            dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="flex w-full items-center justify-center space-x-2">
            <span aria-hidden className="i-ri-upload-cloud-2-line size-6 text-text-tertiary" />
            <div className="text-text-tertiary">
              {t('agentDetail.configure.files.upload.dropzone')}
              <button
                type="button"
                className="inline cursor-pointer border-none bg-transparent p-0 pl-1 text-left text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={() => fileInputRef.current?.click()}
              >
                {t('agentDetail.configure.files.upload.browse')}
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
          <div className="flex grow flex-col items-start gap-0.5 py-1 pr-2">
            <span className="max-w-[calc(100%-30px)] overflow-hidden text-[12px] leading-4 font-medium text-ellipsis whitespace-nowrap text-text-secondary">{file.name}</span>
            <div className="flex h-3 items-center gap-1 self-stretch text-[10px] leading-3 font-medium text-text-tertiary uppercase">
              <span>{t('agentDetail.configure.files.upload.fileType')}</span>
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
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (file: AgentFileNode) => void
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [file, setFile] = useState<File>()
  const uploadFileMutation = useMutation(consoleQuery.files.upload.post.mutationOptions())

  const handleUpload = () => {
    if (!file || uploadFileMutation.isPending)
      return

    uploadFileMutation.mutate({
      body: {
        file,
      },
    }, {
      onSuccess: (uploadedFile) => {
        toast.success(t('agentDetail.configure.files.upload.success'))
        onUploaded(toAgentFileNode(uploadedFile))
        setFile(undefined)
        onOpenChange(false)
      },
      onError: () => {
        toast.error(t('agentDetail.configure.files.upload.failed'))
      },
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      uploadFileMutation.reset()
      setFile(undefined)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('agentDetail.configure.files.upload.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('agentDetail.configure.files.upload.description')}
        </DialogDescription>
        <AgentFileUploader
          file={file}
          onChange={setFile}
        />
        <div className="flex justify-end gap-2 pt-6">
          <Button type="button" onClick={() => handleOpenChange(false)} disabled={uploadFileMutation.isPending}>
            {tCommon('operation.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!file}
            loading={uploadFileMutation.isPending}
            onClick={handleUpload}
          >
            {t('agentDetail.configure.files.upload.action')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
