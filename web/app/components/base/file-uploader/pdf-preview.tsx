import type { RefObject } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useHotkey } from '@tanstack/react-hotkeys'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { basePath } from '@/utils/var'
import { PdfHighlighter, PdfLoader } from './pdf-highlighter-adapter'

type PdfPreviewProps = {
  url: string
  popupRef: RefObject<HTMLDivElement | null>
}

export function PdfPreview({ url, popupRef }: PdfPreviewProps) {
  const { t } = useTranslation(['common'])
  const [scale, setScale] = useState(1)

  const zoomIn = () => {
    setScale((prevScale) => Math.min(prevScale * 1.2, 15))
  }

  const zoomOut = () => {
    setScale((prevScale) => Math.max(prevScale / 1.2, 0.5))
  }

  useHotkey(
    'ArrowUp',
    (event) => {
      if (event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      zoomIn()
    },
    {
      target: popupRef,
      enabled: true,
      ignoreInputs: true,
      requireReset: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )
  useHotkey(
    'ArrowDown',
    (event) => {
      if (event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      zoomOut()
    },
    {
      target: popupRef,
      enabled: true,
      ignoreInputs: true,
      requireReset: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  const zoomOutLabel = t(($) => $['operation.zoomOut'], { ns: 'common' })
  const zoomInLabel = t(($) => $['operation.zoomIn'], { ns: 'common' })

  return (
    <>
      <div
        tabIndex={-1}
        className="h-[95vh] max-h-full w-screen max-w-full overflow-hidden"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'center',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <PdfLoader
          workerSrc={`${basePath}/pdf.worker.min.mjs`}
          url={url}
          beforeLoad={<LoadingPlaceholder className="h-64" />}
        >
          {(pdfDocument) => {
            return (
              <PdfHighlighter
                pdfDocument={pdfDocument}
                enableAreaSelection={(event) => event.altKey}
                scrollRef={noop}
                onScrollChange={noop}
                onSelectionFinished={() => null}
                highlightTransform={() => {
                  return <div />
                }}
                highlights={[]}
              />
            )
          }}
        </PdfLoader>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={zoomOutLabel}
              className="absolute top-6 right-24 flex size-8 cursor-pointer items-center justify-center rounded-lg"
              onClick={zoomOut}
            >
              <span aria-hidden className="i-ri-zoom-out-line size-4 text-gray-500" />
            </button>
          }
        />
        <TooltipContent>{zoomOutLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={zoomInLabel}
              className="absolute top-6 right-16 flex size-8 cursor-pointer items-center justify-center rounded-lg"
              onClick={zoomIn}
            >
              <span aria-hidden className="i-ri-zoom-in-line size-4 text-gray-500" />
            </button>
          }
        />
        <TooltipContent>{zoomInLabel}</TooltipContent>
      </Tooltip>
    </>
  )
}
