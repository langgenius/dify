'use client'

import type { KnowledgeFsDocumentMultimodalItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function DocumentMultimodalAsset({
  item,
}: {
  item: KnowledgeFsDocumentMultimodalItemResponse
}) {
  const { t } = useTranslation('dataset')
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set())
  const source = [item.thumbnail_url, item.asset_url].find(
    (candidate) => candidate && !failedSources.has(candidate),
  )
  const rawLabel =
    item.caption?.trim() || item.title?.trim() || item.text_preview?.trim() || item.ocr_text?.trim()
  const label = rawLabel && rawLabel.length > 500 ? `${rawLabel.slice(0, 497)}...` : rawLabel

  const handleError = () => {
    if (!source) return
    setFailedSources((current) => new Set(current).add(source))
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
