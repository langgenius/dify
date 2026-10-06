'use client'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { QRCodeCanvas as QRCode } from 'qrcode.react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadUrl } from '@/utils/download'

type Props = Readonly<{
  content: string
  downloadLabel?: string
  scanLabel?: string
  triggerLabel?: string
}>

const prefixEmbedded = 'overview.appInfo.qrcode.title'

const ShareQRCode = ({ content, downloadLabel, scanLabel, triggerLabel }: Props) => {
  const { t } = useTranslation(['appOverview'])
  const qrCodeRef = useRef<HTMLDivElement>(null)

  const downloadQR = () => {
    const canvas = qrCodeRef.current?.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return
    downloadUrl({ url: canvas.toDataURL(), fileName: 'qrcode.png' })
  }

  const tooltipText = triggerLabel ?? t(($) => $[`${prefixEmbedded}`], { ns: 'appOverview' })
  /* v8 ignore next -- react-i18next returns a non-empty key/string in configured runtime; empty fallback protects against missing i18n payloads. @preserve */
  const safeTooltipText = tooltipText || ''
  const downloadText =
    downloadLabel ?? t(($) => $['overview.appInfo.qrcode.download'], { ns: 'appOverview' })

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <IconButton aria-label={safeTooltipText}>
                  <span className="i-ri-qr-code-line size-4" aria-hidden="true" />
                </IconButton>
              }
            />
          }
        />
        <TooltipContent>{safeTooltipText}</TooltipContent>
      </Tooltip>
      <PopoverContent
        ref={qrCodeRef}
        placement="bottom-end"
        className="flex w-58 flex-col items-center rounded-lg p-4 shadow-xs"
      >
        <PopoverTitle className="sr-only">{safeTooltipText}</PopoverTitle>
        <QRCode size={160} value={content} className="mb-2" />
        <div className="flex items-center system-xs-regular">
          {scanLabel ? (
            <>
              <div className="text-text-tertiary">{scanLabel}</div>
              <div className="text-text-tertiary">·</div>
            </>
          ) : null}
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-left text-text-accent-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={downloadQR}
          >
            {downloadText}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ShareQRCode
