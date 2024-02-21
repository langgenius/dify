import { memo } from 'react'
import type { EdgeProps } from 'reactflow'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from 'reactflow'

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps) => {
  const [
    edgePath,
    labelX,
    labelY,
  ] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    borderRadius: 30,
    offset: -20,
  })

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ strokeWidth: 5 }} />
      <EdgeLabelRenderer>
        <div
          className={`
            flex items-center px-2 h-6 bg-white rounded-lg shadow-xs
            text-[10px] font-semibold text-gray-700
            nodrag nopan
          `}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          Topic 2
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(CustomEdge)
