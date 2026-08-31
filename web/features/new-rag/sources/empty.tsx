'use client'

import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { newKnowledgeAddSourcePath } from '../routes'

const emptySourceShortcuts = [
  {
    brand: 'firecrawl',
    iconClass: 'i-custom-public-common-firecrawl',
    provider: 'Firecrawl',
    sourceType: 'websiteCrawl',
  },
  {
    brand: 'jina',
    iconClass: 'i-custom-public-llm-jina',
    provider: 'Jina Reader',
    sourceType: 'websiteCrawl',
  },
  {
    brand: 'notion',
    iconClass: 'i-custom-public-common-notion text-text-primary',
    provider: 'Notion',
    sourceType: 'onlineDocuments',
  },
  {
    brand: 'google-drive',
    iconClass: 'i-custom-public-common-google-drive',
    provider: 'Google Drive',
    sourceType: 'onlineDrive',
  },
  {
    brand: 'confluence',
    iconClass: 'i-custom-public-new-rag-confluence',
    provider: 'Confluence',
    sourceType: 'onlineDocuments',
  },
] as const

export function SourcesEmpty({
  canAddSource,
  knowledgeSpaceId,
}: {
  canAddSource: boolean
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')

  return (
    <div className="mt-2.5 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex items-center gap-3 opacity-85">
        {emptySourceShortcuts.map((shortcut) => {
          const icon = (
            <span
              key={shortcut.brand}
              aria-hidden
              data-brand={shortcut.brand}
              className={`${shortcut.iconClass} size-8`}
            />
          )
          if (!canAddSource) return icon
          return (
            <Link
              key={shortcut.brand}
              href={newKnowledgeAddSourcePath(knowledgeSpaceId, {
                provider: shortcut.provider,
                sourceType: shortcut.sourceType,
              })}
              className="inline-flex size-8 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              {icon}
              <span className="sr-only">{shortcut.provider}</span>
            </Link>
          )
        })}
        {canAddSource ? (
          <Link
            aria-label={t(($) => $['newKnowledge.moreProviders'])}
            href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
            className="inline-flex size-8 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span
              aria-hidden
              data-brand="more"
              className="i-ri-more-fill size-8 text-text-quaternary"
            />
          </Link>
        ) : (
          <span
            aria-hidden
            data-brand="more"
            className="i-ri-more-fill size-8 text-text-quaternary"
          />
        )}
      </div>
      <div className="flex flex-col items-center gap-1.5 pt-1.5">
        <h2 className="title-xl-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.sourcesEmptyTitle'])}
        </h2>
        <p className="w-full max-w-110 body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.sourcesEmptyDescription'])}
        </p>
      </div>
      {canAddSource && (
        <Link
          href={newKnowledgeAddSourcePath(knowledgeSpaceId)}
          className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-components-button-primary-bg px-3.5 system-sm-medium text-components-button-primary-text shadow-sm outline-hidden hover:bg-components-button-primary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          {t(($) => $['newKnowledge.addSource'])}
        </Link>
      )}
    </div>
  )
}
