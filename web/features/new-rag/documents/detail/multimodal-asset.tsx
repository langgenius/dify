'use client'

import type { KnowledgeFsDocumentMultimodalItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ImageList from '@/app/components/datasets/common/image-list'
// oxlint-disable-next-line no-restricted-imports
import { get } from '@/service/base'

const CONSOLE_API_PATH = '/console/api'

function consoleApiAssetPath(source: string) {
  const url = new URL(source, 'http://dify.invalid')
  if (!url.pathname.startsWith(`${CONSOLE_API_PATH}/`)) return undefined
  return `${url.pathname.slice(CONSOLE_API_PATH.length)}${url.search}`
}

function protectedDocumentAssetQueryOptions(sources: string[]) {
  const firstSource = sources[0]
  const enabled = Boolean(firstSource && consoleApiAssetPath(firstSource))

  return queryOptions({
    enabled,
    queryFn: async ({ signal }) => {
      for (const rawSource of sources) {
        const apiAssetPath = consoleApiAssetPath(rawSource)
        if (!apiAssetPath) return { rawSource }
        try {
          const response = await get<Response>(
            apiAssetPath,
            { signal },
            { needAllResponseContent: true, silent: true },
          )
          return { blob: await response.blob(), rawSource }
        } catch (error) {
          if (signal.aborted) throw error
        }
      }
      throw new Error('Document multimodal asset is unavailable')
    },
    queryKey: ['knowledge-fs', 'document-multimodal-asset', sources],
    retry: false,
  })
}

export function DocumentMultimodalAsset({
  item,
}: {
  item: KnowledgeFsDocumentMultimodalItemResponse
}) {
  const { t } = useTranslation('dataset')
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set())
  const sources = [item.asset_url, item.thumbnail_url].filter((candidate): candidate is string =>
    Boolean(candidate && !failedSources.has(candidate)),
  )
  const firstSource = sources[0]
  const protectedSource = Boolean(firstSource && consoleApiAssetPath(firstSource))
  const assetQuery = useQuery(protectedDocumentAssetQueryOptions(sources))
  const resolvedRawSource = protectedSource ? assetQuery.data?.rawSource : firstSource
  const resolvedBlob = protectedSource ? assetQuery.data?.blob : undefined
  const [loadedAsset, setLoadedAsset] = useState<{ objectUrl: string; rawSource: string }>()
  const source = resolvedBlob
    ? loadedAsset && loadedAsset.rawSource === resolvedRawSource
      ? loadedAsset.objectUrl
      : undefined
    : resolvedRawSource
  const rawLabel =
    item.caption?.trim() || item.title?.trim() || item.text_preview?.trim() || item.ocr_text?.trim()
  const label = rawLabel && rawLabel.length > 500 ? `${rawLabel.slice(0, 497)}...` : rawLabel
  const imageName = label || t(($) => $['newKnowledge.documentImageAlt'])

  useEffect(() => {
    if (!resolvedBlob || !resolvedRawSource) return
    const objectUrl = URL.createObjectURL(resolvedBlob)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Browser object URLs are external resources created and revoked with this effect lifecycle.
    setLoadedAsset({ objectUrl, rawSource: resolvedRawSource })

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [resolvedBlob, resolvedRawSource])

  const handleError = () => {
    if (!resolvedRawSource) return
    setFailedSources((current) => new Set(current).add(resolvedRawSource))
  }

  return (
    <div data-testid={`document-multimodal-${item.id}`}>
      {source ? (
        <ImageList
          images={[
            {
              extension: 'image',
              mimeType: resolvedBlob?.type || 'image/*',
              name: imageName,
              size: resolvedBlob?.size ?? 0,
              sourceUrl: source,
            },
          ]}
          limit={1}
          onImageError={handleError}
          size="md"
        />
      ) : firstSource && assetQuery.isPending ? (
        <div
          aria-busy="true"
          className="flex size-8 items-center justify-center text-text-tertiary"
        >
          <span aria-hidden className="i-ri-loader-4-line size-4 animate-spin" />
        </div>
      ) : (
        <div
          aria-label={`${imageName}: ${t(($) => $['newKnowledge.documentImageUnavailable'])}`}
          className="flex size-8 items-center justify-center rounded-md border border-divider-subtle bg-background-section text-text-tertiary"
          role="img"
        >
          <span aria-hidden className="i-ri-image-line size-4" />
        </div>
      )}
    </div>
  )
}
