'use client'
import React from 'react'
import Tooltip from '@/app/components/base/tooltip'
import { t } from 'i18next'
import s from './style.module.css'
import copy from 'copy-to-clipboard'


type ICopyBtnProps = {
  value: string
  className?: string
}

const CopyBtn = ({
  value,
  className,
}: ICopyBtnProps) => {
  const [isCopied, setIsCopied] = React.useState(false)

  return (
    <div className={`${className}`}>
      <Tooltip
        selector="copy-btn-tooltip"
        content={(isCopied ? t('appApi.copied') : t('appApi.copy')) as string}
        className='z-10'
      >
          <div 
            className={`box-border p-0.5 flex items-center justify-center rounded-md bg-white cursor-pointer`}
            style={{
              boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)'
            }}
            onClick={() => {
              copy(value)
              setIsCopied(true)
            }}
          >
            <div className={`w-6 h-6 hover:bg-gray-50  ${s.copyIcon} ${isCopied ? s.copied : ''}`}></div>
          </div>
      </Tooltip>
    </div>
  )
}

export default CopyBtn
