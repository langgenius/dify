'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardFill,
  RiClipboardLine,
} from '@remixicon/react'
import { debounce } from 'lodash-es'
import copy from 'copy-to-clipboard'
import copyStyle from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import ActionButton from '@/app/components/base/action-button'

type Props = {
  content: string
  className?: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

const CopyFeedback = ({ content }: Props) => {
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
      <ActionButton>
        <div
          onClick={onClickCopy}
          onMouseLeave={onMouseLeave}
        >
          {isCopied && <RiClipboardFill className='h-4 w-4' />}
          {!isCopied && <RiClipboardLine className='h-4 w-4' />}
        </div>
      </ActionButton>
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
        className={`h-8 w-8 cursor-pointer rounded-lg hover:bg-components-button-ghost-bg-hover ${className ?? ''
        }`}
      >
        <div
          onClick={onClickCopy}
          onMouseLeave={onMouseLeave}
          className={`h-full w-full ${copyStyle.copyIcon} ${isCopied ? copyStyle.copied : ''
          }`}
        ></div>
      </div>
    </Tooltip>
  )
}
