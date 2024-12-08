import type { FC } from 'react'
import { createPortal } from 'react-dom'
import 'react-pdf-highlighter/dist/style.css'
import { PdfHighlighter, PdfLoader } from 'react-pdf-highlighter'
import { RiCloseLine } from '@remixicon/react'
import React, { useEffect, useRef } from 'react'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

type PdfPreviewProps = {
  url: string
  onCancel: () => void
}

const PdfPreview: FC<PdfPreviewProps> = ({
  url,
  onCancel,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)

    // Set focus to the container element
    if (containerRef.current)
      containerRef.current.focus()

    // Cleanup function
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/80 z-[1000] ${!isMobile && 'p-8'}`}
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div className='h-[95vh] w-[100vw] max-w-full max-h-full overflow-y-auto scrollbar-hide'>
        <PdfLoader url={url} beforeLoad={<div className='flex justify-center items-center h-64'>
          <svg className='animate-spin -ml-1 mr-3 h-5 w-5 text-primary-600'
            xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24'>
            <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4'/>
            <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8V2.5'/>
          </svg>
          <span><Loading type='app' /></span>
        </div>}>
          {(pdfDocument) => {
            return (
              <PdfHighlighter
                pdfDocument={pdfDocument}
                enableAreaSelection={event => event.altKey}
                scrollRef={() => {
                }}
                onScrollChange={() => {
                }}
                onSelectionFinished={() => null}
                highlightTransform={() => {
                  return <div/>
                }}
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
