'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
import copy from 'copy-to-clipboard'
import Tooltip from '../tooltip'
import {
  Copy,
  CopyCheck,
} from '@/app/components/base/icons/src/vender/line/files'

type Props = {
  content: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

export const CopyIcon = ({ content }: Props) => {
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
      <div onMouseLeave={onMouseLeave}>
        {!isCopied
          ? (
            <Copy className='mx-1 h-3.5 w-3.5 cursor-pointer text-text-tertiary' onClick={onClickCopy} />
          )
          : (
            <CopyCheck className='mx-1 h-3.5 w-3.5 text-text-tertiary' />
          )
        }
      </div>
    </Tooltip>
  )
}

export default CopyIcon
