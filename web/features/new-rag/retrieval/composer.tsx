'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import { QueryImageThumbnail } from './query-image-thumbnail'
import {
  retrievalComposerFactsAtom,
  updateRetrievalComposerImagesAtom,
  updateRetrievalComposerModeAtom,
  updateRetrievalComposerQueryAtom,
} from './state/graph'
import { runRetrievalAtom } from './state/runtime'
import { useQueryImageUploads } from './use-query-image-uploads'

const runRetrievalHotkey = 'Mod+Enter' satisfies Hotkey
const queryImageMaxBytes = 10 * 1024 * 1024
const queryImagesMaxBytes = 32 * 1024 * 1024
const queryImageTypes = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

export function RetrievalComposer() {
  const { t } = useTranslation(['knowledgeRetrieval', 'knowledgeSpace', 'common', 'custom'])
  const { disabled, images, mode, query, runnable, uploads } = useAtomValueRawSync(
    retrievalComposerFactsAtom,
  )
  const updateQuery = useSetAtom(updateRetrievalComposerQueryAtom)
  const updateMode = useSetAtom(updateRetrievalComposerModeAtom)
  const updateImages = useSetAtom(updateRetrievalComposerImagesAtom)
  const run = useSetAtom(runRetrievalAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const upload = useQueryImageUploads()
  const [validationError, setValidationError] = useState<string>()
  const imageCount = images.length + uploads.length
  const hasFailedUploads = uploads.some((item) => item.status === 'failed')

  const selectImages = (files: FileList | null) => {
    if (!files?.length || disabled) return
    setValidationError(undefined)
    const candidates = [...files].slice(0, Math.max(0, 4 - imageCount))
    if (candidates.length < files.length)
      setValidationError(t(($) => $['retrievalTest.imageLimit'], { ns: 'knowledgeRetrieval' }))
    let aggregateBytes =
      images.reduce((total, image) => total + image.sizeBytes, 0) +
      uploads.reduce((total, item) => total + item.file.size, 0)
    const accepted = candidates.filter((file) => {
      const valid =
        queryImageTypes.has(file.type) &&
        file.size > 0 &&
        file.size <= queryImageMaxBytes &&
        aggregateBytes + file.size <= queryImagesMaxBytes
      if (valid) aggregateBytes += file.size
      return valid
    })
    if (accepted.length !== candidates.length)
      setValidationError(t(($) => $['retrievalTest.imageInvalid'], { ns: 'knowledgeRetrieval' }))
    upload.add(accepted)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (uploadFileId: string) => {
    updateImages(images.filter((item) => item.uploadFileId !== uploadFileId))
  }

  return (
    <div className="shrink-0">
      <div className="overflow-hidden rounded-xl bg-components-panel-bg shadow-xs inset-ring-2 inset-ring-components-input-border-active-prompt-2">
        <label className="sr-only" htmlFor="retrieval-test-query">
          {t(($) => $['retrievalTest.queryPlaceholder'], { ns: 'knowledgeRetrieval' })}
        </label>
        <textarea
          id="retrieval-test-query"
          value={query}
          maxLength={2000}
          disabled={disabled}
          placeholder={t(($) => $['retrievalTest.queryPlaceholder'], { ns: 'knowledgeRetrieval' })}
          className="block h-36 w-full resize-none bg-transparent p-3.5 body-md-regular text-text-primary outline-hidden placeholder:text-text-quaternary"
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (matchesKeyboardEvent(event.nativeEvent, runRetrievalHotkey)) {
              event.preventDefault()
              run()
            }
          }}
        />
        {imageCount > 0 && (
          <ul
            aria-label={t(($) => $['retrievalTest.queryImages'], { ns: 'knowledgeRetrieval' })}
            className="flex gap-2 overflow-x-auto px-3.5 pt-1.5 pb-2"
          >
            {images.map((image) => (
              <li key={image.uploadFileId} className="relative shrink-0">
                <QueryImageThumbnail image={image} className="size-16" />
                <IconButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={t(($) => $['retrievalTest.removeImage'], {
                    ns: 'knowledgeRetrieval',
                    name: image.name,
                  })}
                  className="absolute -inset-e-1 -top-1 rounded-full shadow-xs"
                  disabled={disabled}
                  onClick={() => removeImage(image.uploadFileId)}
                >
                  <span aria-hidden className="i-ri-close-line size-3.5" />
                </IconButton>
              </li>
            ))}
            {uploads.map((item) => (
              <li key={item.id} className="relative shrink-0" aria-label={item.file.name}>
                <QueryImageThumbnail
                  image={{ name: item.file.name, previewUrl: item.previewUrl }}
                  className="size-16"
                />
                <div
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-lg',
                    item.status === 'failed'
                      ? 'bg-background-overlay-destructive ring-2 ring-state-destructive-border ring-inset'
                      : 'bg-background-overlay-alt',
                  )}
                >
                  {item.status === 'uploading' ? (
                    <ProgressCircle
                      value={item.progress}
                      color="white"
                      size="large"
                      aria-label={`${t(($) => $.uploading, { ns: 'custom' })} ${item.file.name}`}
                    />
                  ) : (
                    <IconButton
                      type="button"
                      aria-label={`${t(($) => $['operation.retry'], { ns: 'common' })} ${item.file.name}`}
                      aria-describedby="retrieval-image-upload-error"
                      disabled={disabled}
                      onClick={() => upload.retry(item)}
                    >
                      <span
                        aria-hidden
                        className="i-ri-restart-line size-5 text-text-primary-on-surface"
                      />
                    </IconButton>
                  )}
                </div>
                <IconButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={t(($) => $['retrievalTest.removeImage'], {
                    ns: 'knowledgeRetrieval',
                    name: item.file.name,
                  })}
                  className="absolute -inset-e-1 -top-1 rounded-full shadow-xs"
                  disabled={disabled}
                  onClick={() => upload.remove(item.id)}
                >
                  <span aria-hidden className="i-ri-close-line size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {validationError && (
          <p role="alert" className="px-3.5 pb-2 text-sm text-text-destructive">
            {validationError}
          </p>
        )}
        {hasFailedUploads && (
          <p
            id="retrieval-image-upload-error"
            role="alert"
            className="px-3.5 pb-2 text-sm text-text-destructive"
          >
            {t(($) => $['retrievalTest.imageUploadFailed'], { ns: 'knowledgeRetrieval' })}
          </p>
        )}
        <div className="flex min-h-13 items-center justify-between gap-3 p-2.5">
          <RetrievalModeSegmentedControl
            aria-label={t(($) => $['settings.retrievalModeLabel'], { ns: 'knowledgeSpace' })}
            appearance="composer"
            disabled={disabled}
            value={mode}
            onChange={updateMode}
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              aria-label={t(($) => $['retrievalTest.addImages'], { ns: 'knowledgeRetrieval' })}
              accept="image/gif,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled || imageCount >= 4}
              multiple
              type="file"
              onChange={(event) => selectImages(event.target.files)}
            />
            <Button
              variant="secondary"
              disabled={disabled || imageCount >= 4}
              onClick={() => fileInputRef.current?.click()}
            >
              <span aria-hidden className="i-ri-image-add-line size-4" />
              {t(($) => $['retrievalTest.addImages'], { ns: 'knowledgeRetrieval' })}
            </Button>
            <Button variant="primary" className="px-3.25" disabled={!runnable} onClick={run}>
              <span aria-hidden className="i-ri-play-circle-line size-4" />
              {t(($) => $['retrievalTest.run'], { ns: 'knowledgeRetrieval' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
