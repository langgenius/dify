'use client'

import { Kbd } from '@langgenius/dify-ui/kbd'
import { useTranslation } from 'react-i18next'

type FooterProps = {
  resultCount: number | null
  canActivate: boolean
  hasPartialFailure: boolean
}

export function Footer({ resultCount, canActivate, hasPartialFailure }: FooterProps) {
  const { t } = useTranslation()

  const renderLeftContent = () => {
    if (hasPartialFailure) {
      return (
        <span className="text-red-500">
          {t(($) => $['gotoAnything.someServicesUnavailable'], { ns: 'app' })}
        </span>
      )
    }

    if (resultCount !== null && resultCount > 0) {
      return t(($) => $['gotoAnything.resultCount'], { ns: 'app', count: resultCount })
    }

    return null
  }

  const renderRightContent = () => {
    return (
      <span className="opacity-60">
        {canActivate ? (
          <span className="flex items-center gap-1">
            <span>{t(($) => $['gotoAnything.activate'], { ns: 'app' })}</span>
            <Kbd>Enter</Kbd>
          </span>
        ) : (
          t(($) => $['gotoAnything.pressEscToClose'], { ns: 'app' })
        )}
      </span>
    )
  }

  return (
    <div className="border-t border-divider-subtle bg-components-panel-bg-blur px-4 py-2 text-xs text-text-tertiary">
      <div className="flex min-h-4 items-center justify-between">
        <span>{renderLeftContent()}</span>
        {renderRightContent()}
      </div>
    </div>
  )
}
