import type { FC } from 'react'
import { RiCloseLine, RiZoomInLine, RiZoomOutLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { t } from 'i18next'
import * as React from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { PdfHighlighter, PdfLoader } from 'react-pdf-highlighter'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import 'react-pdf-highlighter/dist/style.css'

type PdfPreviewProps = {
  url: string
  onCancel: () => void
}

const PdfPreview: FC<PdfPreviewProps> = ({
  url,
  onCancel,
}) => {
  const media = useBreakpoints()
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const isMobile = media === MediaType.mobile

  const zoomIn = () => {
    setScale(prevScale => Math.min(prevScale * 1.2, 15))
    setPosition({ x: position.x - 50, y: position.y - 50 })
  }

  const zoomOut = () => {
    setScale((prevScale) => {
      const newScale = Math.max(prevScale / 1.2, 0.5)
      if (newScale === 1)
        setPosition({ x: 0, y: 0 })
      else
        setPosition({ x: position.x + 50, y: position.y + 50 })

      return newScale
    })
  }

  useHotkeys('esc', onCancel)
  useHotkeys('up', zoomIn)
  useHotkeys('down', zoomOut)

  return createPortal(
    <div
      className={`fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 ${!isMobile && 'p-8'}`}
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div
        className="h-[95vh] max-h-full w-[100vw] max-w-full overflow-hidden"
        style={{ transform: `scale(${scale})`, transformOrigin: 'center', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <PdfLoader
          workerSrc="/pdf.worker.min.mjs"
          url={url}
          beforeLoad={<div className="flex h-64 items-center justify-center"><Loading type="app" /></div>}
        >
          {(pdfDocument) => {
            return (
              <PdfHighlighter
                pdfDocument={pdfDocument}
                enableAreaSelection={event => event.altKey}
                scrollRef={noop}
                onScrollChange={noop}
                onSelectionFinished={() => null}
                highlightTransform={() => { return <div /> }}
                highlights={[]}
              />
            )
          }}
        </PdfLoader>
      </div>
      <Tooltip popupContent={t('operation.zoomOut', { ns: 'common' })}>
        <div
          className="absolute right-24 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={zoomOut}
        >
          <RiZoomOutLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.zoomIn', { ns: 'common' })}>
        <div
          className="absolute right-16 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={zoomIn}
        >
          <RiZoomInLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.cancel', { ns: 'common' })}>
        <div
          className="absolute right-6 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/8 backdrop-blur-[2px]"
          onClick={onCancel}
        >
          <RiCloseLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
    </div>,
    document.body,
  )
}

export default PdfPreview
