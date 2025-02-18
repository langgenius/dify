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
    <div className={`bg-components-input-bg-normal hover:bg-state-base-hover flex items-center rounded-lg py-2 ${className}`}>
      <div className="flex h-5 grow items-center">
        {children}
        <div className='relative h-full grow text-[13px]'>
          <div className='r-0 absolute left-0 top-0 w-full cursor-pointer truncate pl-2 pr-2' onClick={() => {
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
        <div className="bg-divider-regular h-4 shrink-0 border" />
        <Tooltip
          popupContent={isCopied ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
          position='bottom'
        >
          <div className="shrink-0 px-0.5">
            <div className={`hover:bg-state-base-hover box-border flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg ${s.copyIcon} ${isCopied ? s.copied : ''}`} onClick={() => {
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
