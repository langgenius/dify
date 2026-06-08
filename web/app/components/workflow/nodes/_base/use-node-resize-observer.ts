import { useEffect } from 'react'

type ResizeObserverParams = {
  enabled: boolean
  nodeRef: React.RefObject<HTMLDivElement | null>
  onResize: () => void
}

const useNodeResizeObserver = ({
  enabled,
  nodeRef,
  onResize,
}: ResizeObserverParams) => {
  useEffect(() => {
    if (!enabled || !nodeRef.current)
      return

    const resizeObserver = new ResizeObserver(() => {
      onResize()
    })

    resizeObserver.observe(nodeRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [enabled, nodeRef, onResize])
}

export default useNodeResizeObserver
