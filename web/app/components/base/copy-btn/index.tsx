'use client'
import { useState } from 'react'
import { t } from 'i18next'
import { debounce } from 'lodash-es'
import copy from 'copy-to-clipboard'
import s from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'

type ICopyBtnProps = {
  value: string
  className?: string
  isPlain?: boolean
}

const CopyBtn = ({
  value,
  className,
  isPlain,
}: ICopyBtnProps) => {
  const [isCopied, setIsCopied] = useState(false)

  const onClickCopy = debounce(() => {
    copy(value)
    setIsCopied(true)
  }, 100)

  const onMouseLeave = debounce(() => {
    setIsCopied(false)
  }, 100)

  return (
    <div className={`${className}`}>
      <Tooltip
        popupContent={(isCopied ? t('appApi.copied') : t('appApi.copy'))}
        asChild={false}
      >
        <div
          onMouseLeave={onMouseLeave}
          className={'box-border p-0.5 flex items-center justify-center rounded-md bg-components-button-secondary-bg cursor-pointer'}
          style={!isPlain
            ? {
              boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
            }
            : {}}
          onClick={onClickCopy}
        >
          <div className={`w-6 h-6 rounded-md hover:bg-components-button-secondary-bg-hover  ${s.copyIcon} ${isCopied ? s.copied : ''}`}></div>
        </div>
      </Tooltip>
    </div>
  )
}

export default CopyBtn
