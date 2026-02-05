'use client'

import { RiZoomInLine, RiZoomOutLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { PdfHighlighter, PdfLoader } from 'react-pdf-highlighter'
import Loading from '@/app/components/base/loading'
import 'react-pdf-highlighter/dist/style.css'

type PdfFilePreviewProps = {
  downloadUrl: string
}

const PdfFilePreview = ({ downloadUrl }: PdfFilePreviewProps) => {
  const [scale, setScale] = useState(1)

  const zoomIn = () => {
    setScale(prevScale => Math.min(prevScale * 1.2, 3))
  }

  const zoomOut = () => {
    setScale(prevScale => Math.max(prevScale / 1.2, 0.5))
  }

  useHotkeys('up', zoomIn)
  useHotkeys('down', zoomOut)

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <button
          type="button"
          onClick={zoomOut}
          className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-components-panel-bg shadow-md hover:bg-state-base-hover"
          aria-label="Zoom out"
        >
          <RiZoomOutLine className="size-4 text-text-tertiary" />
        </button>
        <button
          type="button"
          onClick={zoomIn}
          className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-components-panel-bg shadow-md hover:bg-state-base-hover"
          aria-label="Zoom in"
        >
          <RiZoomInLine className="size-4 text-text-tertiary" />
        </button>
      </div>

      <div className="h-full w-full overflow-auto">
        <div
          className="min-h-full p-6"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
        >
          <PdfLoader
            workerSrc="/pdf.worker.min.mjs"
            url={downloadUrl}
            beforeLoad={(
              <div className="flex h-64 items-center justify-center">
                <Loading type="app" />
              </div>
            )}
          >
            {pdfDocument => (
              <PdfHighlighter
                pdfDocument={pdfDocument}
                enableAreaSelection={() => false}
                scrollRef={noop}
                onScrollChange={noop}
                onSelectionFinished={() => null}
                highlightTransform={() => <div />}
                highlights={[]}
              />
            )}
          </PdfLoader>
        </div>
      </div>
    </div>
  )
}

export default React.memo(PdfFilePreview)
