'use client'

import { useTranslation } from 'react-i18next'

export function KnowledgeRoutePlaceholder({ type }: { type: 'documents' | 'sources' }) {
  const { t } = useTranslation('dataset')

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
      <span
        aria-hidden
        className={`${type === 'sources' ? 'i-ri-links-line' : 'i-ri-file-text-line'} size-7 text-text-tertiary`}
      />
      <h2 className="mt-4 title-xl-semi-bold text-text-primary">
        {t(($) => (type === 'sources' ? $['newKnowledge.sources'] : $['newKnowledge.documents']))}
      </h2>
      <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
        {t(($) => $['newKnowledge.routeUnavailable'])}
      </p>
    </div>
  )
}
