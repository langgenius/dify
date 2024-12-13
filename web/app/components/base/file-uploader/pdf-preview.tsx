import type { FC } from 'react'
import { createPortal } from 'react-dom'
import 'react-pdf-highlighter/dist/style.css'
import { PdfHighlighter, PdfLoader } from 'react-pdf-highlighter'
import { t } from 'i18next'
import { RiCloseLine, RiZoomInLine, RiZoomOutLine } from '@remixicon/react'
import React, { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Tooltip from '@/app/components/base/tooltip'

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
      className={`fixed inset-0 flex items-center justify-center bg-black/80 z-[1000] ${!isMobile && 'p-8'}`}
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div
        className='h-[95vh] w-[100vw] max-w-full max-h-full overflow-hidden'
        style={{ transform: `scale(${scale})`, transformOrigin: 'center', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <PdfLoader
          workerSrc='/pdf.worker.min.mjs'
          url={url}
          beforeLoad={<div className='flex justify-center items-center h-64'><Loading type='app' /></div>}
        >
          {(pdfDocument) => {
            return (
              <PdfHighlighter
                pdfDocument={pdfDocument}
                enableAreaSelection={event => event.altKey}
                scrollRef={() => { }}
                onScrollChange={() => { }}
                onSelectionFinished={() => null}
                highlightTransform={() => { return <div/> }}
                highlights={[]}
              />
            )
          }}
        </PdfLoader>
      </div>
      <Tooltip popupContent={t('common.operation.zoomOut')}>
        <div className='absolute top-6 right-24 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={zoomOut}>
          <RiZoomOutLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.zoomIn')}>
        <div className='absolute top-6 right-16 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={zoomIn}>
          <RiZoomInLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.cancel')}>
        <div
          className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/8 rounded-lg backdrop-blur-[2px] cursor-pointer'
          onClick={onCancel}>
          <RiCloseLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
    </div>,
    document.body,
  )
}

export default PdfPreview
