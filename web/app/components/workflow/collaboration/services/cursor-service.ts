import type { RefObject } from 'react'
import type { CursorPosition } from '../types/collaboration'
import type { ReactFlowInstance } from 'reactflow'

export type CursorServiceConfig = {
  minMoveDistance?: number
  throttleMs?: number
}

export class CursorService {
  private containerRef: RefObject<HTMLElement> | null = null
  private reactFlowInstance: ReactFlowInstance | null = null
  private isTracking = false
  private onCursorUpdate: ((cursors: Record<string, CursorPosition>) => void) | null = null
  private onEmitPosition: ((position: CursorPosition) => void) | null = null
  private lastEmitTime = 0
  private lastPosition: { x: number; y: number } | null = null
  private config: Required<CursorServiceConfig>

  constructor(config: CursorServiceConfig = {}) {
    this.config = {
      minMoveDistance: config.minMoveDistance ?? 5,
      throttleMs: config.throttleMs ?? 300,
    }
  }

  startTracking(
    containerRef: RefObject<HTMLElement>,
    onEmitPosition: (position: CursorPosition) => void,
    reactFlowInstance?: ReactFlowInstance,
  ): void {
    if (this.isTracking) this.stopTracking()

    this.containerRef = containerRef
    this.onEmitPosition = onEmitPosition
    this.reactFlowInstance = reactFlowInstance || null
    this.isTracking = true

    if (containerRef.current)
      containerRef.current.addEventListener('mousemove', this.handleMouseMove)
  }

  stopTracking(): void {
    if (this.containerRef?.current)
      this.containerRef.current.removeEventListener('mousemove', this.handleMouseMove)

    this.containerRef = null
    this.reactFlowInstance = null
    this.onEmitPosition = null
    this.isTracking = false
    this.lastPosition = null
  }

  setCursorUpdateHandler(handler: (cursors: Record<string, CursorPosition>) => void): void {
    this.onCursorUpdate = handler
  }

  updateCursors(cursors: Record<string, CursorPosition>): void {
    if (this.onCursorUpdate)
      this.onCursorUpdate(cursors)
  }

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.containerRef?.current || !this.onEmitPosition) return

    const rect = this.containerRef.current.getBoundingClientRect()
    let x = event.clientX - rect.left
    let y = event.clientY - rect.top

    // Transform coordinates to ReactFlow world coordinates if ReactFlow instance is available
    if (this.reactFlowInstance) {
      const viewport = this.reactFlowInstance.getViewport()
      // Convert screen coordinates to world coordinates
      // World coordinates = (screen coordinates - viewport translation) / zoom
      x = (x - viewport.x) / viewport.zoom
      y = (y - viewport.y) / viewport.zoom
    }

    // Always emit cursor position (remove boundary check since world coordinates can be negative)
    const now = Date.now()
    const timeThrottled = now - this.lastEmitTime > this.config.throttleMs
    const distanceThrottled = !this.lastPosition
        || (Math.abs(x - this.lastPosition.x) > this.config.minMoveDistance / (this.reactFlowInstance?.getZoom() || 1))
        || (Math.abs(y - this.lastPosition.y) > this.config.minMoveDistance / (this.reactFlowInstance?.getZoom() || 1))

    if (timeThrottled && distanceThrottled) {
        this.lastPosition = { x, y }
        this.lastEmitTime = now
        this.onEmitPosition({
        x,
        y,
        userId: '',
        timestamp: now,
        })
    }
  }
}
