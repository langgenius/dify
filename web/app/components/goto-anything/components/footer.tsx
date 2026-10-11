'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { useTranslation } from 'react-i18next'

type FooterProps = {
  resultCount: number | null
  isLoading: boolean
  hasPartialFailure: boolean
  onSelectMode: (query: string) => void
}

export function Footer({ resultCount, isLoading, hasPartialFailure, onSelectMode }: FooterProps) {
  const { t } = useTranslation(['app'])
  const commandsLabel = t(($) => $['gotoAnything.groups.commands'], { ns: 'app' })
  const scopesLabel = t(($) => $['gotoAnything.selectSearchType'], { ns: 'app' })

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-divider-subtle bg-components-panel-bg-blur px-3 py-2 text-xs text-text-tertiary">
      <div className="flex min-h-6 min-w-0 flex-1 items-center gap-1">
        {resultCount === null ? (
          <>
            <Button
              variant="ghost"
              size="small"
              aria-label={commandsLabel}
              onClick={() => onSelectMode('/')}
            >
              <Kbd>/</Kbd>
              <span className="hidden sm:inline">{commandsLabel}</span>
            </Button>
            <Button
              variant="ghost"
              size="small"
              aria-label={scopesLabel}
              onClick={() => onSelectMode('@')}
            >
              <Kbd>@</Kbd>
              <span className="hidden sm:inline">{scopesLabel}</span>
            </Button>
          </>
        ) : (
          <span>
            {hasPartialFailure
              ? t(($) => $['gotoAnything.someServicesUnavailable'], { ns: 'app' })
              : isLoading && resultCount === 0
                ? t(($) => $['gotoAnything.searching'], { ns: 'app' })
                : t(($) => $['gotoAnything.resultCount'], { ns: 'app', count: resultCount })}
          </span>
        )}
      </div>
      {resultCount !== null && resultCount > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          <span>{t(($) => $['gotoAnything.activate'], { ns: 'app' })}</span>
          <Kbd>Enter</Kbd>
        </span>
      )}
    </div>
  )
}
