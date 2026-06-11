'use client'

import { Input } from '@langgenius/dify-ui/input'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  sourceSearchTextAtom,
} from '@/features/deployments/create-guide/state'

export function SourceSearchInput() {
  const { t } = useTranslation('deployments')
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const setSourceSearchText = useSetAtom(sourceSearchTextAtom)

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 i-ri-search-line size-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
      <Input
        id="create-guide-source-search"
        aria-label={t('createGuide.source.sourceApp')}
        value={sourceSearchText}
        onChange={event => setSourceSearchText(event.target.value)}
        placeholder={t('createGuide.source.searchPlaceholder')}
        className="h-9 pr-8 pl-8"
      />
      {sourceSearchText && (
        <button
          type="button"
          aria-label={t('createGuide.source.clearSearch')}
          onClick={() => setSourceSearchText('')}
          className="absolute top-1/2 right-2.5 flex size-4 -translate-y-1/2 items-center justify-center text-text-quaternary hover:text-text-secondary"
        >
          <span className="i-ri-close-circle-fill size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
