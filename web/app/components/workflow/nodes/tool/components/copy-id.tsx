'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiFileCopyLine } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { debounce } from 'lodash-es'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  content: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

const CopyFeedbackNew = ({ content }: Props) => {
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
    <div className='inline-flex w-full pb-0.5' onClick={e => e.stopPropagation()} onMouseLeave={onMouseLeave}>
      <Tooltip
        popupContent={
          (isCopied
            ? t(`${prefixEmbedded}.copied`)
            : t(`${prefixEmbedded}.copy`)) || ''
        }
      >
        <div
          className='group/copy flex w-full items-center gap-0.5 '
          onClick={onClickCopy}
        >
          <div
            className='system-2xs-regular w-0 grow cursor-pointer truncate text-text-quaternary group-hover:text-text-tertiary'
          >{content}</div>
          <RiFileCopyLine className='h-3 w-3 shrink-0 text-text-tertiary opacity-0 group-hover/copy:opacity-100' />
        </div>
      </Tooltip>
    </div>
  )
}

export default CopyFeedbackNew
