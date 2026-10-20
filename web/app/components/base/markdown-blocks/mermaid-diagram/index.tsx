'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogPortal, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DiagramPreview } from './diagram-preview'
import { diagramTheme } from './diagram-theme'
import { useDiagram } from './use-diagram'

export function MermaidDiagram({ source }: { source: string }) {
  const { t } = useTranslation(['common', 'app'])
  const [previewSource, setPreviewSource] = useState('')
  const diagram = useDiagram({ source, mode: 'inline', onRendered: setPreviewSource })
  const zoomInLabel = t(($) => $['operation.zoomIn'])
  const zoomOutLabel = t(($) => $['operation.zoomOut'])
  const resetLabel = t(($) => $['operation.reset'])

  return (
    <Dialog disablePointerDismissal>
      <div className="min-w-0 rounded-b-xl bg-components-panel-bg p-3">
        <div className={cn(diagramTheme, 'w-full min-w-0 wrap-anywhere')}>
          <Tooltip<string>>
            {({ payload }) => (
              <>
                <div className="mb-2 flex items-center justify-end gap-1">
                  <TooltipTrigger
                    payload={zoomInLabel}
                    render={
                      <IconButton
                        size="lg"
                        aria-label={zoomInLabel}
                        disabled={!diagram.ready}
                        onClick={() => diagram.zoomBy(1.25)}
                      >
                        <span aria-hidden className="i-ri-add-line size-4" />
                      </IconButton>
                    }
                  />
                  <TooltipTrigger
                    payload={zoomOutLabel}
                    render={
                      <IconButton
                        size="lg"
                        aria-label={zoomOutLabel}
                        disabled={!diagram.ready}
                        onClick={() => diagram.zoomBy(0.8)}
                      >
                        <span aria-hidden className="i-ri-subtract-line size-4" />
                      </IconButton>
                    }
                  />
                  <TooltipTrigger
                    payload={resetLabel}
                    render={
                      <IconButton
                        size="lg"
                        aria-label={resetLabel}
                        disabled={!diagram.ready}
                        onClick={diagram.reset}
                      >
                        <span aria-hidden className="i-ri-restart-line size-4" />
                      </IconButton>
                    }
                  />
                  <DialogTrigger
                    disabled={!previewSource}
                    render={<Button size="small" variant="ghost" />}
                  >
                    <span aria-hidden className="i-ri-fullscreen-line size-4" />
                    {t(($) => $['mermaid.preview'], { ns: 'app' })}
                  </DialogTrigger>
                </div>
                <TooltipContent>{payload}</TooltipContent>
              </>
            )}
          </Tooltip>
          <div ref={diagram.stageRef}>
            <div
              ref={diagram.canvasRef}
              className="mx-auto min-w-0 shrink-0 [&>svg]:mx-auto [&>svg]:block [&>svg:focus-visible]:outline-2 [&>svg:focus-visible]:outline-offset-2 [&>svg:focus-visible]:outline-text-accent"
            />
          </div>
          {diagram.error && (
            <p
              role="status"
              className="mt-2 system-xs-regular whitespace-pre-wrap text-text-destructive"
            >
              {diagram.error}
            </p>
          )}
        </div>
      </div>
      <DialogPortal>
        <DiagramPreview source={previewSource} />
      </DialogPortal>
    </Dialog>
  )
}
