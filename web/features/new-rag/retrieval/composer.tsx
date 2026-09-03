'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import { QueryImageThumbnail } from './query-image-thumbnail'
import {
  retrievalComposerFactsAtom,
  updateRetrievalComposerImagesAtom,
  updateRetrievalComposerModeAtom,
  updateRetrievalComposerQueryAtom,
} from './state/graph'
import { runRetrievalAtom } from './state/runtime'

const runRetrievalHotkey = 'Mod+Enter' satisfies Hotkey
const queryImageMaxBytes = 10 * 1024 * 1024
const queryImagesMaxBytes = 32 * 1024 * 1024
const queryImageTypes = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

export function RetrievalComposer() {
  const { t } = useTranslation('knowledgeSpace')
  const { disabled, images, mode, query, runnable } = useAtomValue(retrievalComposerFactsAtom)
  const updateQuery = useSetAtom(updateRetrievalComposerQueryAtom)
  const updateMode = useSetAtom(updateRetrievalComposerModeAtom)
  const updateImages = useSetAtom(updateRetrievalComposerImagesAtom)
  const run = useSetAtom(runRetrievalAtom)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const upload = useMutation(consoleQuery.files.upload.post.mutationOptions())

  const selectImages = async (files: FileList | null) => {
    if (!files?.length || disabled || upload.isPending) return
    const available = Math.max(0, 4 - images.length)
    const candidates = [...files].slice(0, available)
    if (candidates.length < files.length) toast.error(t(($) => $['retrievalTest.imageLimit']))
    let aggregateBytes = images.reduce((total, image) => total + image.sizeBytes, 0)
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
      toast.error(t(($) => $['retrievalTest.imageInvalid']))
    const next = [...images]
    try {
      for (const file of accepted) {
        const uploaded = await upload.mutateAsync({ body: { file } })
        next.push({
          name: file.name,
          previewUrl: URL.createObjectURL(file),
          sizeBytes: file.size,
          uploadFileId: uploaded.id,
        })
      }
      updateImages(next)
    } catch {
      for (const image of next.slice(images.length)) {
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl)
      }
      toast.error(t(($) => $['retrievalTest.imageUploadFailed']))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = (uploadFileId: string) => {
    updateImages(images.filter((item) => item.uploadFileId !== uploadFileId))
  }

  return (
    <div className="shrink-0">
      <div className="overflow-hidden rounded-xl bg-components-panel-bg shadow-xs inset-ring-2 inset-ring-components-input-border-active-prompt-2">
        <label className="sr-only" htmlFor="retrieval-test-query">
          {t(($) => $['retrievalTest.queryPlaceholder'])}
        </label>
        <textarea
          id="retrieval-test-query"
          value={query}
          maxLength={2000}
          disabled={disabled}
          placeholder={t(($) => $['retrievalTest.queryPlaceholder'])}
          className="block h-36 w-full resize-none bg-transparent p-3.5 body-md-regular text-text-primary outline-hidden placeholder:text-text-quaternary"
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={(event) => {
            if (matchesKeyboardEvent(event.nativeEvent, runRetrievalHotkey)) {
              event.preventDefault()
              run()
            }
          }}
        />
        {images.length > 0 && (
          <ul
            aria-label={t(($) => $['retrievalTest.queryImages'])}
            className="flex gap-2 overflow-x-auto px-3.5 pb-2"
          >
            {images.map((image) => (
              <li key={image.uploadFileId} className="relative shrink-0">
                <QueryImageThumbnail image={image} className="size-16" />
                <IconButton
                  type="button"
                  size="sm"
                  aria-label={t(($) => $['retrievalTest.removeImage'], {
                    name: image.name,
                  })}
                  className="absolute -top-1 -right-1 shadow-xs"
                  disabled={disabled || upload.isPending}
                  onClick={() => removeImage(image.uploadFileId)}
                >
                  <span aria-hidden className="i-ri-close-line size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-h-13 items-center justify-between gap-3 p-2.5">
          <RetrievalModeSegmentedControl
            aria-label={t(($) => $['settings.retrievalModeLabel'])}
            appearance="composer"
            disabled={disabled}
            value={mode}
            onChange={updateMode}
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              aria-label={t(($) => $['retrievalTest.addImages'])}
              accept="image/gif,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled || upload.isPending || images.length >= 4}
              multiple
              type="file"
              onChange={(event) => void selectImages(event.target.files)}
            />
            <Button
              variant="secondary"
              disabled={disabled || upload.isPending || images.length >= 4}
              onClick={() => fileInputRef.current?.click()}
            >
              <span aria-hidden className="i-ri-image-add-line size-4" />
              {t(($) => $['retrievalTest.addImages'])}
            </Button>
            <Button
              variant="primary"
              className="px-3.25"
              disabled={!runnable || upload.isPending}
              onClick={run}
            >
              <span aria-hidden className="i-ri-play-circle-line size-4" />
              {t(($) => $['retrievalTest.run'])}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
