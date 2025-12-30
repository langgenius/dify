'use client'
import copy from 'copy-to-clipboard'
import { debounce } from 'es-toolkit/compat'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Copy,
  CopyCheck,
} from '@/app/components/base/icons/src/vender/line/files'
import Tooltip from '../tooltip'

type Props = {
  content: string
}

const prefixEmbedded = 'overview.appInfo.embedded'

const CopyIcon = ({ content }: Props) => {
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
          ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
          : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''
      }
    >
      <div onMouseLeave={onMouseLeave}>
        {!isCopied
          ? (
              <Copy className="mx-1 h-3.5 w-3.5 cursor-pointer text-text-tertiary" onClick={onClickCopy} />
            )
          : (
              <CopyCheck className="mx-1 h-3.5 w-3.5 text-text-tertiary" />
            )}
      </div>
    </Tooltip>
  )
}

export default CopyIcon
