import { memo } from 'react'
import type { EdgeProps } from 'reactflow'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSimpleBezierPath,
} from 'reactflow'
import BlockSelector from './block-selector'
import { useStore } from './store'

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps) => {
  const hoveringEdgeId = useStore(state => state.hoveringEdgeId)
  const [
    edgePath,
    labelX,
    labelY,
  ] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#2970FF' : '#D0D5DD',
          strokeWidth: 2,
        }}
      />
      <EdgeLabelRenderer>
        {
          hoveringEdgeId === id && (
            <div
              className='nopan nodrag'
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                pointerEvents: 'all',
              }}
            >
              <BlockSelector
                asChild
                onSelect={() => {}}
              />
            </div>
          )
        }
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(CustomEdge)
