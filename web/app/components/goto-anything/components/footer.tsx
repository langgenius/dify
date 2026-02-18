'use client'

import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export type FooterProps = {
  resultCount: number
  searchMode: string
  isError: boolean
  isCommandsMode: boolean
  hasQuery: boolean
}

const Footer: FC<FooterProps> = ({
  resultCount,
  searchMode,
  isError,
  isCommandsMode,
  hasQuery,
}) => {
  const { t } = useTranslation()

  const renderLeftContent = () => {
    if (resultCount > 0 || isError) {
      if (isError) {
        return (
          <span className="text-red-500">
            {t('gotoAnything.someServicesUnavailable', { ns: 'app' })}
          </span>
        )
      }

      return (
        <>
          {t('gotoAnything.resultCount', { ns: 'app', count: resultCount })}
          {searchMode !== 'general' && (
            <span className="ml-2 opacity-60">
              {t('gotoAnything.inScope', { ns: 'app', scope: searchMode.replace('@', '') })}
            </span>
          )}
        </>
      )
    }

    return (
      <span className="opacity-60">
        {(() => {
          if (isCommandsMode)
            return t('gotoAnything.selectToNavigate', { ns: 'app' })

          if (hasQuery)
            return t('gotoAnything.searching', { ns: 'app' })

          return t('gotoAnything.startTyping', { ns: 'app' })
        })()}
      </span>
    )
  }

  const renderRightContent = () => {
    if (resultCount > 0 || isError) {
      return (
        <span className="opacity-60">
          {searchMode !== 'general'
            ? t('gotoAnything.clearToSearchAll', { ns: 'app' })
            : t('gotoAnything.useAtForSpecific', { ns: 'app' })}
        </span>
      )
    }

    return (
      <span className="opacity-60">
        {hasQuery || isCommandsMode
          ? t('gotoAnything.tips', { ns: 'app' })
          : t('gotoAnything.pressEscToClose', { ns: 'app' })}
      </span>
    )
  }

  return (
    <div className="border-t border-divider-subtle bg-components-panel-bg-blur px-4 py-2 text-xs text-text-tertiary">
      <div className="flex min-h-[16px] items-center justify-between">
        <span>{renderLeftContent()}</span>
        {renderRightContent()}
      </div>
    </div>
  )
}

export default Footer
