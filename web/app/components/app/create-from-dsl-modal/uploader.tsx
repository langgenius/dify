'use client'
import type { ChangeEvent, DragEvent, MouseEvent, RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { formatFileSize } from '@/utils/format'

const importFormats = {
  app: { accept: '.yaml,.yml,.ifpkg', displayName: 'DSL' },
  dsl: { accept: '.yaml,.yml', displayName: 'YAML' },
  pipeline: { accept: '.pipeline', displayName: 'PIPELINE' },
} as const

type Props = Readonly<{
  file: File | undefined
  updateFile: (file?: File) => void
  browseButtonRef?: RefObject<HTMLButtonElement | null>
  className?: string
  importType?: 'app' | 'dsl' | 'pipeline'
  disabled?: boolean
}>

export function Uploader({
  file,
  updateFile,
  browseButtonRef,
  className,
  importType = 'dsl',
  disabled = false,
}: Props) {
  const { t } = useTranslation()
  const { accept, displayName: formatName } = importFormats[importType]
  const isPackage = importType === 'app' && file?.name.toLowerCase().endsWith('.ifpkg')
  const displayName = isPackage ? t(($) => $.appPackage, { ns: 'app' }) : formatName
  const fileIconClassName = isPackage
    ? 'i-ri-file-zip-line text-text-tertiary'
    : 'i-custom-public-files-yaml'
  const hint = importType === 'app' ? t(($) => $.importAppFormats, { ns: 'app' }) : undefined
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<HTMLDivElement>(null)
  const fileUploaderRef = useRef<HTMLInputElement>(null)
  const internalBrowseButtonRef = useRef<HTMLButtonElement>(null)
  const resolvedBrowseButtonRef = browseButtonRef ?? internalBrowseButtonRef
  const fileRowRef = useRef<HTMLDivElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  const fileNameId = useId()
  const fileMetadataId = useId()
  const hintId = useId()
  const pendingFocusRef = useRef<{
    target: 'browse' | 'file'
    focusVisible: boolean
  } | null>(null)

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current
    if (!pendingFocus) return

    const focusTarget = file
      ? pendingFocus.target === 'file' && fileRowRef.current
      : pendingFocus.target === 'browse' && resolvedBrowseButtonRef.current

    if (!focusTarget) return
    focusTarget.focus({
      preventScroll: true,
      ...(pendingFocus.focusVisible && { focusVisible: true }),
    })
    pendingFocusRef.current = null
  }, [file, resolvedBrowseButtonRef])

  const selectFile = (nextFile?: File) => {
    const extensions = accept.split(',').map((extension) => extension.trim().toLowerCase())
    if (
      nextFile &&
      !extensions.some((extension) => nextFile.name.toLowerCase().endsWith(extension))
    ) {
      pendingFocusRef.current = null
      toast.error(
        t(($) => $['dslUploader.invalidFileType'], { ns: 'app', types: extensions.join(', ') }),
      )
      return
    }
    updateFile(nextFile)
  }

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    if (e.target !== dragRef.current) setDragging(true)
  }
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.target === dragRef.current) setDragging(false)
  }
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (disabled || !e.dataTransfer) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 1) {
      toast.error(t(($) => $['stepOne.uploader.validation.count'], { ns: 'datasetCreation' }))
      return
    }
    if (files[0]) selectFile(files[0])
  }
  const selectHandle = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    pendingFocusRef.current =
      document.activeElement === resolvedBrowseButtonRef.current
        ? { target: 'file', focusVisible: e.detail === 0 }
        : null
    const originalFile = file
    if (fileUploaderRef.current) {
      fileUploaderRef.current.value = ''
      fileUploaderRef.current.click()
      fileUploaderRef.current.oncancel = () => {
        pendingFocusRef.current = null
        updateFile(originalFile)
      }
    }
  }
  const removeFile = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    pendingFocusRef.current =
      document.activeElement === removeButtonRef.current
        ? { target: 'browse', focusVisible: e.detail === 0 }
        : null
    if (fileUploaderRef.current) fileUploaderRef.current.value = ''
    updateFile()
  }
  const fileChangeHandle = (e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const currentFile = e.target.files?.[0]
    if (!currentFile) pendingFocusRef.current = null
    selectFile(currentFile)
  }

  return (
    <div className={cn('mt-6', className)}>
      <input
        ref={fileUploaderRef}
        style={{ display: 'none' }}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={fileChangeHandle}
      />
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!file && (
          <div
            className={cn(
              'relative flex min-h-12 items-center rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-3 py-2 text-sm font-normal',
              dragging &&
                'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
            )}
          >
            <div className="flex w-full items-center justify-center space-x-2">
              <span
                aria-hidden
                className="i-ri-upload-cloud-2-line size-6 shrink-0 text-text-tertiary"
              />
              <div className="min-w-0 text-text-tertiary">
                <div>
                  <span>{t(($) => $['dslUploader.button'], { ns: 'app' })}</span>
                  <Button
                    ref={resolvedBrowseButtonRef}
                    aria-describedby={hint ? hintId : undefined}
                    variant="ghost-accent"
                    size="small"
                    className="ml-1 h-6 px-1 text-sm font-normal hover:bg-transparent hover:not-data-disabled:underline"
                    disabled={disabled}
                    onClick={selectHandle}
                  >
                    {t(($) => $['dslUploader.browse'], { ns: 'app' })}
                  </Button>
                </div>
                {hint && (
                  <p id={hintId} className="system-xs-regular text-text-tertiary">
                    {hint}
                  </p>
                )}
              </div>
            </div>
            {dragging && <div ref={dragRef} className="absolute top-0 left-0 size-full" />}
          </div>
        )}
        {file && (
          <div
            ref={fileRowRef}
            role="group"
            tabIndex={-1}
            aria-labelledby={fileNameId}
            aria-describedby={fileMetadataId}
            className={cn(
              'group flex items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
              'hover:bg-components-panel-on-panel-item-bg-hover',
            )}
          >
            <div className="flex items-center justify-center p-3">
              <span aria-hidden className={cn(fileIconClassName, 'size-6 shrink-0')} />
            </div>
            <div className="flex min-w-0 grow flex-col items-start gap-0.5 py-1 pr-2">
              <span
                id={fileNameId}
                className="font-inter max-w-full truncate text-xs leading-4 font-medium text-text-secondary"
              >
                {file.name}
              </span>
              <div
                id={fileMetadataId}
                className="font-inter flex flex-wrap items-center gap-1 self-stretch text-2xs leading-3 font-medium text-text-tertiary uppercase"
              >
                <span>{displayName}</span>
                <span className="text-text-quaternary">·</span>
                <span>{formatFileSize(file.size)}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center pr-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton
                ref={removeButtonRef}
                variant="ghost"
                size="md"
                aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
                disabled={disabled}
                onClick={removeFile}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4 text-text-tertiary" />
              </IconButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
