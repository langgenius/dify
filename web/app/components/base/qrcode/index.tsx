'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { QRCodeCanvas as QRCode } from 'qrcode.react'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { downloadUrl } from '@/utils/download'

type Props = {
  content: string
}

const prefixEmbedded = 'overview.appInfo.qrcode.title'

const ShareQRCode = ({ content }: Props) => {
  const { t } = useTranslation()
  const [isShow, setIsShow] = useState<boolean>(false)
  const qrCodeRef = useRef<HTMLDivElement>(null)

  const toggleQRCode = (event: React.MouseEvent) => {
    event.stopPropagation()
    setIsShow(prev => !prev)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      /* v8 ignore next 2 -- this handler can fire during open/close transitions where the panel ref is temporarily null; guard is defensive. @preserve */
      if (qrCodeRef.current && !qrCodeRef.current.contains(event.target as Node))
        setIsShow(false)
    }

    if (isShow)
      document.addEventListener('click', handleClickOutside)

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isShow])

  const downloadQR = () => {
    const canvas = qrCodeRef.current?.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement))
      return
    downloadUrl({ url: canvas.toDataURL(), fileName: 'qrcode.png' })
  }

  const handlePanelClick = (event: React.MouseEvent) => {
    event.stopPropagation()
  }

  const tooltipText = t(`${prefixEmbedded}`, { ns: 'appOverview' })
  /* v8 ignore next -- react-i18next returns a non-empty key/string in configured runtime; empty fallback protects against missing i18n payloads. @preserve */
  const safeTooltipText = tooltipText || ''
  const downloadText = t('overview.appInfo.qrcode.download', { ns: 'appOverview' })

  return (
    <Tooltip>
      <div className="relative h-6 w-6">
        <TooltipTrigger
          render={(
            <ActionButton aria-label={safeTooltipText} onClick={toggleQRCode}>
              <span className="i-ri-qr-code-line h-4 w-4" aria-hidden="true" />
            </ActionButton>
          )}
        />
        {isShow && (
          <div
            ref={qrCodeRef}
            className="absolute top-8 -right-8 z-10 flex w-[232px] flex-col items-center rounded-lg bg-components-panel-bg p-4 shadow-xs"
            onClick={handlePanelClick}
          >
            <QRCode size={160} value={content} className="mb-2" />
            <div className="flex items-center system-xs-regular">
              <div className="text-text-tertiary">{t('overview.appInfo.qrcode.scan', { ns: 'appOverview' })}</div>
              <div className="text-text-tertiary">·</div>
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent p-0 text-left text-text-accent-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={downloadQR}
              >
                {downloadText}
              </button>
            </div>
          </div>
        )}
      </div>
      <TooltipContent>
        {safeTooltipText}
      </TooltipContent>
    </Tooltip>
  )
}

export default ShareQRCode
