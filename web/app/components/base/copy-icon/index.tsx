'use client'
import { useClipboard } from 'foxact/use-clipboard'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '../tooltip'

type Props = {
  content: string
}

const prefixEmbedded = 'overview.appInfo.embedded'

const CopyIcon = ({ content }: Props) => {
  const { t } = useTranslation()
  const { copied, copy, reset } = useClipboard()

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  const tooltipText = copied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeTooltipText = tooltipText || ''

  return (
    <Tooltip
      popupContent={safeTooltipText}
    >
      <div onMouseLeave={reset}>
        {!copied
          ? (<span className="i-custom-vender-line-files-copy mx-1 h-3.5 w-3.5 cursor-pointer text-text-tertiary" onClick={handleCopy} data-testid="copy-icon" />)
          : (<span className="i-custom-vender-line-files-copy-check mx-1 h-3.5 w-3.5 text-text-tertiary" data-testid="copied-icon" />)}
      </div>
    </Tooltip>
  )
}

export default CopyIcon
