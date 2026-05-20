import type { FC } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiCloseLine, RiZoomInLine, RiZoomOutLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { PdfHighlighter, PdfLoader } from './pdf-highlighter-adapter'

type PdfPreviewProps = {
  url: string
  onCancel: () => void
}

const PdfPreview: FC<PdfPreviewProps> = ({
  url,
  onCancel,
}) => {
  const { t } = useTranslation()
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

  useHotkeys('up', zoomIn)
  useHotkeys('down', zoomOut)

  const zoomOutLabel = t('operation.zoomOut', { ns: 'common' })
  const zoomInLabel = t('operation.zoomIn', { ns: 'common' })
  const cancelLabel = t('operation.cancel', { ns: 'common' })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
      disablePointerDismissal
    >
      <DialogContent
        className={`inset-0! top-0! left-0! flex h-dvh! max-h-none! w-screen! max-w-none! translate-x-0! translate-y-0! items-center justify-center overflow-hidden! rounded-none! border-none! bg-black/80 shadow-none! ${!isMobile ? 'p-8!' : 'p-0!'}`}
        backdropClassName="bg-transparent!"
      >
        <div
          aria-label={url}
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
          className="h-[95vh] max-h-full w-screen max-w-full overflow-hidden"
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
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={zoomOutLabel}
                className="absolute top-6 right-24 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={zoomOut}
              >
                <RiZoomOutLine className="h-4 w-4 text-gray-500" />
              </button>
            )}
          />
          <TooltipContent>
            {zoomOutLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={zoomInLabel}
                className="absolute top-6 right-16 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={zoomIn}
              >
                <RiZoomInLine className="h-4 w-4 text-gray-500" />
              </button>
            )}
          />
          <TooltipContent>
            {zoomInLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={cancelLabel}
                className="absolute top-6 right-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/8 backdrop-blur-[2px]"
                onClick={onCancel}
              >
                <RiCloseLine className="h-4 w-4 text-gray-500" />
              </button>
            )}
          />
          <TooltipContent>
            {cancelLabel}
          </TooltipContent>
        </Tooltip>
      </DialogContent>
    </Dialog>
  )
}

export default PdfPreview
