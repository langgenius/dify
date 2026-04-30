'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import { debounce } from 'es-toolkit/compat'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  content: string
}

const prefixEmbedded = 'overview.appInfo.embedded'

const CopyFeedbackNew = ({ content }: Props) => {
  const { t } = useTranslation()
  const [isCopied, setIsCopied] = useState<boolean>(false)

  const onClickCopy = debounce(() => {
    copy(content)
    setIsCopied(true)
  }, 100)

  const onMouseLeave = debounce(() => {
    setIsCopied(false)
  }, 100)
  const tooltip = (isCopied
    ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
    : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''

  return (
    <div className="inline-flex w-full pb-0.5" onClick={e => e.stopPropagation()} onMouseLeave={onMouseLeave}>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button
              type="button"
              aria-label={tooltip}
              className="group/copy flex w-full items-center gap-0.5 text-left"
              onClick={onClickCopy}
            >
              <span
                className="w-0 grow cursor-pointer truncate system-2xs-regular text-text-quaternary group-hover:text-text-tertiary"
              >
                {content}
              </span>
              <span aria-hidden className="i-ri-file-copy-line h-3 w-3 shrink-0 text-text-tertiary opacity-0 group-hover/copy:opacity-100" />
            </button>
          )}
        />
        <TooltipContent>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export default CopyFeedbackNew
