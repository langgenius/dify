'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiClipboardFill,
  RiClipboardLine,
} from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useClipboard } from '@/hooks/use-clipboard'
import copyStyle from './style.module.css'

type Props = {
  content: string
  className?: string
}

const prefixEmbedded = 'overview.appInfo.embedded'

const CopyFeedback = ({ content }: Props) => {
  const { t } = useTranslation()
  // Rely on useClipboard's own timer to flip `copied` back to false so the
  // "Copied" tooltip stays visible long enough to be read, matching the
  // KeyValueItem pattern. Do NOT reset on mouse leave.
  const { copied, copy } = useClipboard({ timeout: 2000 })

  const tooltipText = copied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeText = tooltipText || ''

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <ActionButton aria-label={safeText} onClick={handleCopy}>
            {copied && <RiClipboardFill className="h-4 w-4" aria-hidden="true" />}
            {!copied && <RiClipboardLine className="h-4 w-4" aria-hidden="true" />}
          </ActionButton>
        )}
      />
      <TooltipContent>
        {safeText}
      </TooltipContent>
    </Tooltip>
  )
}

export default CopyFeedback

export const CopyFeedbackNew = ({ content, className }: Pick<Props, 'className' | 'content'>) => {
  const { t } = useTranslation()
  const { copied, copy } = useClipboard({ timeout: 2000 })

  const tooltipText = copied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })
  /* v8 ignore next -- i18n test mock always returns a non-empty string; runtime fallback is defensive. -- @preserve */
  const safeText = tooltipText || ''

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label={safeText}
            className={`h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent p-0 hover:bg-components-button-ghost-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden ${className ?? ''}`}
            onClick={handleCopy}
          >
            <div
              className={`h-full w-full ${copyStyle.copyIcon} ${copied ? copyStyle.copied : ''}`}
            >
            </div>
          </button>
        )}
      />
      <TooltipContent>
        {safeText}
      </TooltipContent>
    </Tooltip>
  )
}
