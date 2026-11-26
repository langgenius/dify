import { useLayoutEffect, useRef } from 'react'
import { useWorkflowAppSelector } from '@/app/components/workflow-app/store/workflow'
import styles from './edit-border.module.css'

const DASH_PERIOD = 12

export function BuilderEditBorder() {
  const borderRef = useRef<SVGRectElement>(null)

  useLayoutEffect(() => {
    const border = borderRef.current!
    const fitDashes = () => {
      // Calibrate one path unit per dash/gap pair so the closed seam always aligns.
      const dashCount = Math.max(1, Math.round(border.getTotalLength() / DASH_PERIOD))
      border.setAttribute('pathLength', String(dashCount))
    }

    fitDashes()
    const observer = new ResizeObserver(fitDashes)
    observer.observe(border.ownerSVGElement!)

    return () => observer.disconnect()
  }, [])

  return (
    <svg aria-hidden="true" focusable="false" className={styles.builderEditBorder}>
      <rect ref={borderRef} width="100%" height="100%" rx="21" />
    </svg>
  )
}

export function DifyBuilderNodeDecoration({ nodeId }: { nodeId: string }) {
  const isEditTarget = useWorkflowAppSelector((state) =>
    state.builderEditTargetNodeIds.includes(nodeId),
  )
  return isEditTarget ? <BuilderEditBorder /> : null
}
