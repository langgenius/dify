import type { RefObject } from 'react'
import { useLayoutEffect } from 'react'
import { useStoreApi } from 'reactflow'

// Keep canvas controls usable when zoomed out without subscribing every node to viewport changes.
export function useWorkflowControlScale(containerRef: RefObject<HTMLDivElement | null>) {
  const store = useStoreApi()

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    let currentScale: number | undefined
    const updateScale = (zoom: number) => {
      const scale = Math.max(1, 1 / zoom)
      if (scale === currentScale) return

      currentScale = scale
      container.style.setProperty('--workflow-control-scale', String(scale))
    }

    updateScale(store.getState().transform[2])
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.transform[2] !== previousState.transform[2]) updateScale(state.transform[2])
    })

    return () => {
      unsubscribe()
      container.style.removeProperty('--workflow-control-scale')
    }
  }, [containerRef, store])
}
