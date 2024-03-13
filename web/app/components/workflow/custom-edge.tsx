import {
  memo,
  useCallback,
  useState,
} from 'react'
import type { EdgeProps } from 'reactflow'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSimpleBezierPath,
} from 'reactflow'
import BlockSelector from './block-selector'

const CustomEdge = ({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps) => {
  const [
    edgePath,
    labelX,
    labelY,
  ] = getSimpleBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
  })
  const [open, setOpen] = useState(false)
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: (selected || data?._connectedNodeIsHovering || data?._runned) ? '#2970FF' : '#D0D5DD',
          strokeWidth: 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`
            nopan nodrag
            ${data?._hovering ? 'block' : 'hidden'}
            ${open && '!block'}
          `}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <BlockSelector
            open={open}
            onOpenChange={handleOpenChange}
            asChild
            onSelect={() => {}}
          />
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(CustomEdge)
