'use client'

import type { DragEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { formatFileSize } from '@/utils/format'

export function ImportSkillDialogForm({
  importing,
  onImport,
}: {
  importing: boolean
  onImport: (file: File) => void
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const descriptionId = useId()
  const errorId = useId()
  const [file, setFile] = useState<File>()
  const [invalidFile, setInvalidFile] = useState(false)
  const [dragging, setDragging] = useState(false)

  const selectFiles = (files: File[]) => {
    if (importing || files.length === 0) return
    const [selectedFile] = files
    if (files.length !== 1 || !selectedFile || !/\.(?:zip|skill)$/iu.test(selectedFile.name)) {
      setFile(undefined)
      setInvalidFile(true)
      return
    }
    setFile(selectedFile)
    setInvalidFile(false)
  }

  const hasFiles = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes('Files')

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (file && !importing) onImport(file)
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['skillManagement.importDialog.title'])}</DialogTitle>
        <DialogHeaderCloseButton
          aria-label={tCommon(($) => $['operation.close'])}
          disabled={importing}
        />
      </DialogHeader>
      <DialogBody>
        <div
          role="group"
          aria-label={t(($) => $['skillManagement.importDialog.title'])}
          className={cn(
            'flex min-h-34 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-components-dropzone-border-alt bg-components-dropzone-bg-alt px-5 py-4',
            dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
          )}
          onDragEnter={(event) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            event.stopPropagation()
            if (importing) return
            dragDepthRef.current += 1
            setDragging(true)
          }}
          onDragOver={(event) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = importing ? 'none' : 'copy'
          }}
          onDragLeave={(event) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            event.stopPropagation()
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
            if (dragDepthRef.current === 0) setDragging(false)
          }}
          onDrop={(event) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            event.stopPropagation()
            dragDepthRef.current = 0
            setDragging(false)
            selectFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.skill,application/zip"
            className="hidden"
            aria-label={t(($) => $['skillManagement.importDialog.browse'])}
            aria-describedby={invalidFile ? `${descriptionId} ${errorId}` : descriptionId}
            aria-invalid={invalidFile}
            disabled={importing}
            onChange={(event) => {
              selectFiles(Array.from(event.currentTarget.files ?? []))
              event.currentTarget.value = ''
            }}
          />
          <span aria-hidden className="i-ri-file-zip-line size-8 shrink-0 text-text-quaternary" />
          {file ? (
            <div className="flex w-full items-center justify-center gap-3">
              <div className="min-w-0 text-center">
                <p className="system-sm-medium wrap-anywhere text-text-secondary">{file.name}</p>
                <p className="system-xs-regular text-text-tertiary">{formatFileSize(file.size)}</p>
              </div>
              <IconButton
                aria-label={tCommon(($) => $['operation.remove'])}
                disabled={importing}
                onClick={() => setFile(undefined)}
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            </div>
          ) : (
            <p className="text-center system-md-medium text-text-secondary">
              <Trans
                ns="skill"
                i18nKey={($) => $['skillManagement.importDialog.dropzone']}
                components={{
                  browse: (
                    <button
                      type="button"
                      disabled={importing}
                      aria-describedby={invalidFile ? `${descriptionId} ${errorId}` : descriptionId}
                      className="cursor-pointer rounded-sm text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed"
                      onClick={() => inputRef.current?.click()}
                    />
                  ),
                }}
              />
            </p>
          )}
          <DialogDescription
            id={descriptionId}
            // oxlint-disable-next-line shadcn/no-restyle -- Description is centred under the upload drop zone.
            className="text-center"
          >
            {t(($) => $['skillManagement.importDialog.description'])}
          </DialogDescription>
        </div>
        {invalidFile && (
          <p id={errorId} role="alert" className="mt-2 system-xs-regular text-text-destructive">
            {t(($) => $['skillManagement.importDialog.invalidFile'])}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={importing} render={<Button />}>
          {tCommon(($) => $['operation.cancel'])}
        </DialogClose>
        <Button type="submit" variant="primary" disabled={!file} loading={importing}>
          {t(($) => $['skillManagement.import'])}
        </Button>
      </DialogFooter>
    </form>
  )
}
