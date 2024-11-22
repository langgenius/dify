import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { intersection } from 'lodash-es'
import type { EdgeProps } from 'reactflow'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
} from 'reactflow'
import {
  useAvailableBlocks,
  useNodesInteractions,
} from './hooks'
import BlockSelector from './block-selector'
import type {
  Edge,
  OnSelectBlock,
} from './types'
import { NodeRunningStatus } from './types'
import { ITERATION_CHILDREN_Z_INDEX } from './constants'
import CustomEdgeLinearGradientRender from './custom-edge-linear-gradient-render'
import cn from '@/utils/classnames'

const CustomEdge = ({
  id,
  data,
  source,
  sourceHandleId,
  target,
  targetHandleId,
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
  ] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { availablePrevBlocks } = useAvailableBlocks((data as Edge['data'])!.targetType, (data as Edge['data'])?.isInIteration)
  const { availableNextBlocks } = useAvailableBlocks((data as Edge['data'])!.sourceType, (data as Edge['data'])?.isInIteration)
  const {
    _sourceRunningStatus,
    _targetRunningStatus,
  } = data

  const linearGradientId = useMemo(() => {
    if (
      (
        _sourceRunningStatus === NodeRunningStatus.Succeeded
        || _sourceRunningStatus === NodeRunningStatus.Failed
        || _sourceRunningStatus === NodeRunningStatus.Exception
      ) && (
        _targetRunningStatus === NodeRunningStatus.Succeeded
        || _targetRunningStatus === NodeRunningStatus.Failed
        || _targetRunningStatus === NodeRunningStatus.Exception
      )
    )
      return id
  }, [_sourceRunningStatus, _targetRunningStatus, id])

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])

  const handleInsert = useCallback<OnSelectBlock>((nodeType, toolDefaultValue) => {
    handleNodeAdd(
      {
        nodeType,
        toolDefaultValue,
      },
      {
        prevNodeId: source,
        prevNodeSourceHandle: sourceHandleId || 'source',
        nextNodeId: target,
        nextNodeTargetHandle: targetHandleId || 'target',
      },
    )
  }, [handleNodeAdd, source, sourceHandleId, target, targetHandleId])

  const stroke = useMemo(() => {
    if (linearGradientId)
      return `url(#${linearGradientId})`

    if (selected || data?._connectedNodeIsHovering || data?._run)
      return 'blue'

    return '#D0D5DD'
  }, [data._connectedNodeIsHovering, data._run, linearGradientId, selected])

  return (
    <>
      {
        linearGradientId && (
          <CustomEdgeLinearGradientRender
            id={linearGradientId}
            startColor='#2970FF'
            stopColor='#FF3D71'
          />
        )
      }
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: 2,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            'nopan nodrag hover:scale-125',
            data?._hovering ? 'block' : 'hidden',
            open && '!block',
            data.isInIteration && `z-[${ITERATION_CHILDREN_Z_INDEX}]`,
          )}
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
            onSelect={handleInsert}
            availableBlocksTypes={intersection(availablePrevBlocks, availableNextBlocks)}
            triggerClassName={() => 'hover:scale-150 transition-all'}
          />
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(CustomEdge)
