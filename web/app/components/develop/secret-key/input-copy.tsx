'use client'
import copy from 'copy-to-clipboard'
import { t } from 'i18next'
import * as React from 'react'
import { useEffect, useState } from 'react'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Tooltip from '@/app/components/base/tooltip'

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
          <div
            className="r-0 absolute left-0 top-0 w-full cursor-pointer truncate pl-2 pr-2"
            onClick={() => {
              copy(value)
              setIsCopied(true)
            }}
          >
            <Tooltip
              popupContent={isCopied ? `${t('copied', { ns: 'appApi' })}` : `${t('copy', { ns: 'appApi' })}`}
              position="bottom"
            >
              <span className="text-text-secondary">{value}</span>
            </Tooltip>
          </div>
        </div>
        <div className="h-4 w-px shrink-0 bg-divider-regular" />
        <div className="mx-1"><CopyFeedback content={value} /></div>
      </div>
    </div>
  )
}

export default InputCopy
