'use client'

import { Kbd } from '@langgenius/dify-ui/kbd'
import { useTranslation } from 'react-i18next'

type FooterProps = {
  resultCount: number | null
  isLoading: boolean
  hasPartialFailure: boolean
}

export function Footer({ resultCount, isLoading, hasPartialFailure }: FooterProps) {
  const { t } = useTranslation(['app'])

  if (resultCount === null) return null

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-divider-subtle bg-components-panel-bg-blur px-3 py-2 text-xs text-text-tertiary">
      <span className="flex min-h-6 min-w-0 flex-1 items-center">
        {hasPartialFailure
          ? t(($) => $['gotoAnything.someServicesUnavailable'], { ns: 'app' })
          : isLoading && resultCount === 0
            ? t(($) => $['gotoAnything.searching'], { ns: 'app' })
            : t(($) => $['gotoAnything.resultCount'], { ns: 'app', count: resultCount })}
      </span>
      {resultCount > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          <span>{t(($) => $['gotoAnything.activate'], { ns: 'app' })}</span>
          <Kbd>Enter</Kbd>
        </span>
      )}
    </div>
  )
}
