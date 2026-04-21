'use client'
import {
  RiClipboardFill,
  RiClipboardLine,
} from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import { useClipboard } from '@/hooks/use-clipboard'
import copyStyle from './style.module.css'

type Props = {
  content: string
  className?: string
}

const prefixEmbedded = 'overview.appInfo.embedded'

const CopyFeedback = ({ content }: Props) => {
  const { t } = useTranslation()
  const { copied, copy, reset } = useClipboard()

  const tooltipText = copied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeText = tooltipText || ''

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  return (
    <Tooltip
      popupContent={safeText}
    >
      <ActionButton>
        <div
          onClick={handleCopy}
          onMouseLeave={reset}
        >
          {copied && <RiClipboardFill className="h-4 w-4" />}
          {!copied && <RiClipboardLine className="h-4 w-4" />}
        </div>
      </ActionButton>
    </Tooltip>
  )
}

export default CopyFeedback

export const CopyFeedbackNew = ({ content, className }: Pick<Props, 'className' | 'content'>) => {
  const { t } = useTranslation()
  const { copied, copy, reset } = useClipboard()

  const tooltipText = copied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeText = tooltipText || ''

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  return (
    <Tooltip
      popupContent={safeText}
    >
      <div
        className={`h-8 w-8 cursor-pointer rounded-lg hover:bg-components-button-ghost-bg-hover ${className ?? ''}`}
      >
        <div
          onClick={handleCopy}
          onMouseLeave={reset}
          className={`h-full w-full ${copyStyle.copyIcon} ${copied ? copyStyle.copied : ''}`}
        >
        </div>
      </div>
    </Tooltip>
  )
}
