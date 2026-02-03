'use client'
import { useClipboard } from 'foxact/use-clipboard'
import { useCallback } from 'react'
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
  const { copied, copy, reset } = useClipboard()

  const handleCopy = useCallback(() => {
    copy(content)
  }, [copy, content])

  return (
    <Tooltip
      popupContent={
        (copied
          ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
          : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''
      }
    >
      <div onMouseLeave={reset}>
        {!copied
          ? (
              <Copy className="mx-1 h-3.5 w-3.5 cursor-pointer text-text-tertiary" onClick={handleCopy} />
            )
          : (
              <CopyCheck className="mx-1 h-3.5 w-3.5 text-text-tertiary" />
            )}
      </div>
    </Tooltip>
  )
}

export default CopyIcon
