'use client'

import type { KnowledgeFsDocumentMultimodalItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
// oxlint-disable-next-line no-restricted-imports
import { get } from '@/service/base'

const CONSOLE_API_PATH = '/console/api'

function consoleApiAssetPath(source: string) {
  const url = new URL(source, 'http://dify.invalid')
  if (!url.pathname.startsWith(`${CONSOLE_API_PATH}/`)) return undefined
  return `${url.pathname.slice(CONSOLE_API_PATH.length)}${url.search}`
}

export function DocumentMultimodalAsset({
  item,
}: {
  item: KnowledgeFsDocumentMultimodalItemResponse
}) {
  const { t } = useTranslation('dataset')
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set())
  const rawSource = [item.asset_url, item.thumbnail_url].find(
    (candidate) => candidate && !failedSources.has(candidate),
  )
  const apiAssetPath = rawSource ? consoleApiAssetPath(rawSource) : undefined
  const [loadedAsset, setLoadedAsset] = useState<{ objectUrl: string; rawSource: string }>()
  const source = apiAssetPath
    ? loadedAsset && loadedAsset.rawSource === rawSource
      ? loadedAsset.objectUrl
      : undefined
    : rawSource
  const rawLabel =
    item.caption?.trim() || item.title?.trim() || item.text_preview?.trim() || item.ocr_text?.trim()
  const label = rawLabel && rawLabel.length > 500 ? `${rawLabel.slice(0, 497)}...` : rawLabel

  useEffect(() => {
    if (!apiAssetPath || !rawSource) return

    const abortController = new AbortController()
    let objectUrl: string | undefined

    void get<Response>(
      apiAssetPath,
      { signal: abortController.signal },
      { needAllResponseContent: true, silent: true },
    )
      .then(async (response) => {
        const blob = await response.blob()
        if (abortController.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setLoadedAsset({ objectUrl, rawSource })
      })
      .catch(() => {
        if (abortController.signal.aborted) return
        setFailedSources((current) => new Set(current).add(rawSource))
      })

    return () => {
      abortController.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [apiAssetPath, rawSource])

  const handleError = () => {
    if (!rawSource) return
    setFailedSources((current) => new Set(current).add(rawSource))
  }

  return (
    <figure
      className="overflow-hidden rounded-xl border border-divider-subtle bg-background-section"
      data-testid={`document-multimodal-${item.id}`}
    >
      {source ? (
        <img
          alt={label || t(($) => $['newKnowledge.documentImageAlt'])}
          className="max-h-[36rem] w-full bg-background-default object-contain"
          decoding="async"
          loading="lazy"
          onError={handleError}
          src={source}
        />
      ) : rawSource ? (
        <div
          aria-busy="true"
          className="flex min-h-32 items-center justify-center bg-background-default text-text-tertiary"
        >
          <span aria-hidden className="i-ri-loader-4-line size-5 animate-spin" />
        </div>
      ) : (
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-text-tertiary">
          <span aria-hidden className="i-ri-image-line size-6" />
          <span className="system-xs-regular">
            {t(($) => $['newKnowledge.documentImageUnavailable'])}
          </span>
        </div>
      )}
      {label && (
        <figcaption className="border-t border-divider-subtle px-3 py-2 text-[12px] leading-5 wrap-break-word text-text-tertiary">
          {label}
        </figcaption>
      )}
    </figure>
  )
}
