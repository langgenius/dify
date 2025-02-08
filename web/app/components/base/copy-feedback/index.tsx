'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
import copy from 'copy-to-clipboard'
import copyStyle from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  content: string
  className?: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

const CopyFeedback = ({ content, className }: Props) => {
  const { t } = useTranslation()
  const [isCopied, setIsCopied] = useState<boolean>(false)

  const onClickCopy = debounce(() => {
    copy(content)
    setIsCopied(true)
  }, 100)

  const onMouseLeave = debounce(() => {
    setIsCopied(false)
  }, 100)

  return (
    <Tooltip
      popupContent={
        (isCopied
          ? t(`${prefixEmbedded}.copied`)
          : t(`${prefixEmbedded}.copy`)) || ''
      }
    >
      <div
        className={`w-8 h-8 cursor-pointer hover:bg-state-base-hover rounded-md ${
          className ?? ''
        }`}
      >
        <div
          onClick={onClickCopy}
          onMouseLeave={onMouseLeave}
          className={`w-full h-full ${copyStyle.copyIcon} ${
            isCopied ? copyStyle.copied : ''
          }`}
        ></div>
      </div>
    </Tooltip>
  )
}

export default CopyFeedback

export const CopyFeedbackNew = ({ content, className }: Pick<Props, 'className' | 'content'>) => {
  const { t } = useTranslation()
  const [isCopied, setIsCopied] = useState<boolean>(false)

  const onClickCopy = debounce(() => {
    copy(content)
    setIsCopied(true)
  }, 100)

  const onMouseLeave = debounce(() => {
    setIsCopied(false)
  }, 100)

  return (
    <Tooltip
      popupContent={
        (isCopied
          ? t(`${prefixEmbedded}.copied`)
          : t(`${prefixEmbedded}.copy`)) || ''
      }
    >
      <div
        className={`w-8 h-8 cursor-pointer hover:bg-gray-100 rounded-lg ${
          className ?? ''
        }`}
      >
        <div
          onClick={onClickCopy}
          onMouseLeave={onMouseLeave}
          className={`w-full h-full ${copyStyle.copyIcon} ${
            isCopied ? copyStyle.copied : ''
          }`}
        ></div>
      </div>
    </Tooltip>
  )
}
