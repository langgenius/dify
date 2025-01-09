'use client'
import React, { useEffect, useState } from 'react'
import copy from 'copy-to-clipboard'
import { t } from 'i18next'
import s from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'

type IInputCopyProps = {
  value?: string
  className?: string
  readOnly?: boolean
  children?: React.ReactNode
}

const InputCopy = ({
  value = '',
  className,
  readOnly = true,
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
    <div className={`flex rounded-lg bg-components-input-bg-normal hover:bg-state-base-hover py-2 items-center ${className}`}>
      <div className="flex items-center grow h-5">
        {children}
        <div className='grow text-[13px] relative h-full'>
          <div className='absolute top-0 left-0 w-full pl-2 pr-2 truncate cursor-pointer r-0' onClick={() => {
            copy(value)
            setIsCopied(true)
          }}>
            <Tooltip
              popupContent={isCopied ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
              position='bottom'
            >
              {value}
            </Tooltip>
          </div>
        </div>
        <div className="shrink-0 h-4 bg-divider-regular border" />
        <Tooltip
          popupContent={isCopied ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
          position='bottom'
        >
          <div className="px-0.5 shrink-0">
            <div className={`box-border w-[30px] h-[30px] flex items-center justify-center rounded-lg hover:bg-state-base-hover cursor-pointer ${s.copyIcon} ${isCopied ? s.copied : ''}`} onClick={() => {
              copy(value)
              setIsCopied(true)
            }}>
            </div>
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

export default InputCopy
