'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTrigger,
  DialogViewport,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DiagramCanvas } from './diagram-canvas'
import styles from './diagram.module.css'
import { ExportActions } from './export-actions'
import { useDiagram } from './use-diagram'
import { ZoomControls } from './zoom-controls'

export function MermaidDiagram({ source }: { source: string }) {
  const { t } = useTranslation(['app'])
  const [previewSource, setPreviewSource] = useState('')

  return (
    <Dialog disablePointerDismissal>
      <div className="min-w-0 rounded-b-xl bg-components-panel-bg p-3">
        <DiagramCanvas
          source={source}
          onSourceRendered={setPreviewSource}
          actions={
            <DialogTrigger
              disabled={!previewSource}
              render={<Button size="small" variant="ghost" />}
            >
              <span aria-hidden className="i-ri-fullscreen-line size-4" />
              {t(($) => $['mermaid.preview'], { ns: 'app' })}
            </DialogTrigger>
          }
        />
      </div>
      <DialogPortal>
        <DiagramPreview source={previewSource} />
      </DialogPortal>
    </Dialog>
  )
}

function DiagramPreview({ source }: { source: string }) {
  const { t } = useTranslation(['common'])
  // A preview session keeps its drawing while the answer continues streaming.
  const [snapshot] = useState(source)
  const diagram = useDiagram({ source: snapshot, mode: 'preview' })
  return (
    <>
      <DialogBackdrop />
      <DialogViewport className="p-4 sm:p-8">
        <DialogPopup
          aria-label="Mermaid"
          className={`${styles.diagram} pointer-events-none flex h-full min-h-0 flex-col transition-opacity data-ending-style:scale-100 data-starting-style:scale-100`}
        >
          <div
            className={`${styles.previewActions} pointer-events-auto relative mb-2 flex shrink-0 items-center justify-end gap-1 self-end`}
          >
            <ZoomControls disabled={!diagram.ready} zoomBy={diagram.zoomBy} reset={diagram.reset} />
            <ExportActions exportSvg={diagram.exportSvg} disabled={!diagram.ready} />
            <DialogClose
              render={
                <IconButton size="lg" aria-label={t(($) => $['operation.close'])}>
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
          </div>
          <div ref={diagram.stageRef} className="flex min-h-0 flex-1 items-center">
            <div
              ref={diagram.canvasRef}
              className={`${styles.canvas} pointer-events-auto bg-components-panel-bg`}
            />
          </div>
          {diagram.error && (
            <p
              role="status"
              className="pointer-events-auto mt-2 system-xs-regular text-text-destructive"
            >
              {diagram.error}
            </p>
          )}
        </DialogPopup>
      </DialogViewport>
    </>
  )
}
