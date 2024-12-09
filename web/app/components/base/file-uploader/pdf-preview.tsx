import type { FC } from 'react'
import { createPortal } from 'react-dom'
import 'react-pdf-highlighter/dist/style.css'
import { PdfHighlighter, PdfLoader } from 'react-pdf-highlighter'
import { RiCloseLine } from '@remixicon/react'
import React, { useState } from 'react'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-short'

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

  useKeyboardShortcuts({
    esc: onCancel,
    up: zoomIn,
    down: zoomOut,
  })

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
      <div
        className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/[0.08] rounded-lg backdrop-blur-[2px] cursor-pointer z-[10000]'
        onClick={onCancel}
      >
        <RiCloseLine className='w-4 h-4 text-gray-500'/>
      </div>
    </div>,
    document.body,
  )
}

export default PdfPreview
