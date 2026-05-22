'use client'

import type { SnippetDetail } from '@/models/snippet'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import SnippetInfoDropdown from './dropdown'

type SnippetInfoProps = {
  expand: boolean
  snippet: SnippetDetail
}

const SnippetInfo = ({
  expand,
  snippet,
}: SnippetInfoProps) => {
  const { t } = useTranslation('snippet')

  if (!expand)
    return null

  return (
    <div className="flex flex-col px-2 pt-2 pb-1">
      <div className="flex flex-col gap-2 rounded-xl p-2">
        <div className="flex items-center justify-end">
          <SnippetInfoDropdown snippet={snippet} />
        </div>
        <div className="min-w-0">
          <div className="truncate system-md-semibold text-text-secondary">
            {snippet.name}
          </div>
          <div className="pt-1 system-2xs-medium-uppercase text-text-tertiary">
            {t('typeLabel')}
          </div>
        </div>
        {snippet.description && (
          <p className="line-clamp-3 system-xs-regular break-words text-text-tertiary">
            {snippet.description}
          </p>
        )}
      </div>
    </div>
  )
}

export default React.memo(SnippetInfo)
