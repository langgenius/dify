import { useEffect, useRef } from 'react'
import { useStore } from '../store'

/**
 * Pointer handlers for a comment surface (a hover preview or a thread). While one is hovered
 * the canvas keeps the browser from zooming the page; the flag is shared by every surface, so
 * one clears it on unmount only if it is the one hovered.
 */
export function useCommentHover() {
  const setCommentPreviewHovering = useStore((state) => state.setCommentPreviewHovering)
  const hoveredRef = useRef(false)
  useEffect(
    () => () => {
      if (hoveredRef.current) setCommentPreviewHovering(false)
    },
    [setCommentPreviewHovering],
  )
  const setHovered = (hovered: boolean) => {
    hoveredRef.current = hovered
    setCommentPreviewHovering(hovered)
  }
  return {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  }
}
