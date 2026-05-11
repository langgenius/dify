'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { t } from 'i18next'
import * as React from 'react'
import { useEffect, useState } from 'react'
import CopyFeedback from '@/app/components/base/copy-feedback'
import { writeTextToClipboard } from '@/utils/clipboard'

type IInputCopyProps = {
  value?: string
  className?: string
  children?: React.ReactNode
}

const InputCopy = ({
  value = '',
  className,
  children,
}: IInputCopyProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const copyLabel = isCopied ? `${t('copied', { ns: 'appApi' })}` : `${t('copy', { ns: 'appApi' })}`
  const handleCopy = () => {
    writeTextToClipboard(value).then(() => {
      setIsCopied(true)
    })
  }

  useEffect(() => {
    if (isCopied) {
      const timeout = setTimeout(() => {
        setIsCopied(false)
      }, 1000)

      return () => {
        clearTimeout(timeout)
      }
    }
  }, [isCopied])

  return (
    <div className={`flex items-center rounded-lg bg-components-input-bg-normal py-2 hover:bg-state-base-hover ${className}`}>
      <div className="flex h-5 grow items-center">
        {children}
        <div className="relative h-full grow text-[13px]">
          <button
            type="button"
            className="r-0 absolute top-0 left-0 w-full cursor-pointer truncate border-none bg-transparent py-0 pr-2 pl-2 text-left"
            aria-label={copyLabel}
            onClick={handleCopy}
          >
            <Tooltip>
              <TooltipTrigger
                render={<span className="text-text-secondary">{value}</span>}
              />
              <TooltipContent placement="bottom">
                {copyLabel}
              </TooltipContent>
            </Tooltip>
          </button>
        </div>
        <div className="h-4 w-px shrink-0 bg-divider-regular" />
        <div className="mx-1"><CopyFeedback content={value} /></div>
      </div>
    </div>
  )
}

export default InputCopy
