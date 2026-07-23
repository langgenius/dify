'use client'

import type { ChangeEvent, DragEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '@/utils/format'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'pdf', 'html', 'xlsx', 'csv', 'jsonl'])

export type SelectedFile = {
  error?: 'size' | 'type'
  file: File
}

function extension(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

function toSelectedFile(file: File): SelectedFile {
  if (file.size > MAX_FILE_SIZE) return { error: 'size', file }
  if (!ALLOWED_EXTENSIONS.has(extension(file.name))) return { error: 'type', file }
  return { file }
}

function hasDraggedFiles(event: DragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function FileUploadSelection({
  disabled,
  files,
  onChange,
}: {
  disabled: boolean
  files: SelectedFile[]
  onChange: (files: SelectedFile[]) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tCreation } = useTranslation('datasetCreation')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragging, setDragging] = useState(false)

  const addFiles = (nextFiles: File[]) => {
    const knownFiles = new Set(
      files.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`),
    )
    const uniqueFiles = nextFiles.filter(
      (file) => !knownFiles.has(`${file.name}:${file.size}:${file.lastModified}`),
    )
    onChange([...files, ...uniqueFiles.map(toSelectedFile)])
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event) || disabled) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event) || disabled) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragging(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        disabled={disabled}
        accept={Array.from(ALLOWED_EXTENSIONS, (value) => `.${value}`).join(',')}
        onChange={handleChange}
      />
      <div
        className={cn(
          'flex min-h-16 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3',
          dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => {
          if (!disabled && hasDraggedFiles(event)) event.preventDefault()
        }}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="flex items-center gap-2 system-sm-medium text-text-secondary">
          <span aria-hidden className="i-ri-upload-cloud-2-line size-5 text-text-tertiary" />
          {tCreation(($) => $['stepOne.uploader.button'])}
          <button
            type="button"
            disabled={disabled}
            className="text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:text-text-disabled"
            onClick={() => inputRef.current?.click()}
          >
            {tCreation(($) => $['stepOne.uploader.browse'])}
          </button>
        </p>
        <p className="system-xs-regular text-text-tertiary">
          {tCreation(($) => $['stepOne.uploader.tip'], {
            batchCount: 20,
            size: 15,
            supportTypes: 'TXT, Markdown, PDF, HTML, XLSX, CSV, JSONL',
          })}
        </p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map(({ error, file }) => (
            <li
              key={`${file.name}:${file.size}:${file.lastModified}`}
              className={cn(
                'flex min-w-0 items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs',
                error && 'border-state-destructive-border bg-state-destructive-hover',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mx-3 i-ri-file-text-fill size-6 shrink-0 text-text-accent',
                  error && 'text-text-destructive',
                )}
              />
              <span className="min-w-0 flex-1 py-2">
                <span className="block truncate system-xs-medium text-text-secondary">
                  {file.name}
                </span>
                <span className="block system-2xs-medium-uppercase text-text-tertiary">
                  {extension(file.name)} · {formatFileSize(file.size)}
                  {error === 'size' &&
                    ` · ${tCreation(($) => $['stepOne.uploader.validation.size'], { size: 15 })}`}
                  {error === 'type' &&
                    ` · ${tCreation(($) => $['stepOne.uploader.validation.typeError'])}`}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`${tCommon(($) => $['operation.delete'])} ${file.name}`}
                className="m-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:text-text-disabled"
                onClick={() => onChange(files.filter((item) => item.file !== file))}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.some(({ error }) => error) && (
        <p role="alert" className="system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.uploadValidationFailed'])}
        </p>
      )}
    </div>
  )
}
