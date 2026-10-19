import type { ReactNode } from 'react'
import styles from './diagram.module.css'
import { useDiagram } from './use-diagram'
import { ZoomControls } from './zoom-controls'

type DiagramCanvasProps = {
  source: string
  actions: ReactNode
  onSourceRendered: (source: string) => void
}

export function DiagramCanvas({ source, actions, onSourceRendered }: DiagramCanvasProps) {
  const diagram = useDiagram({ source, mode: 'inline', onRendered: onSourceRendered })
  return (
    <div className={styles.diagram}>
      <div className="mb-2 flex items-center justify-end gap-1">
        <ZoomControls disabled={!diagram.ready} zoomBy={diagram.zoomBy} reset={diagram.reset} />
        {actions}
      </div>
      <div ref={diagram.stageRef}>
        <div ref={diagram.canvasRef} className={styles.canvas} />
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
  )
}
