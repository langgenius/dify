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
import { getEdgeColor } from './utils'
import { ITERATION_CHILDREN_Z_INDEX, LOOP_CHILDREN_Z_INDEX } from './constants'
import CustomEdgeLinearGradientRender from './custom-edge-linear-gradient-render'
import cn from '@/utils/classnames'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

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
  const { availablePrevBlocks } = useAvailableBlocks((data as Edge['data'])!.targetType, (data as Edge['data'])?.isInIteration || (data as Edge['data'])?.isInLoop)
  const { availableNextBlocks } = useAvailableBlocks((data as Edge['data'])!.sourceType, (data as Edge['data'])?.isInIteration || (data as Edge['data'])?.isInLoop)
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
        || _targetRunningStatus === NodeRunningStatus.Running
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
    if (selected)
      return getEdgeColor(NodeRunningStatus.Running)

    if (linearGradientId)
      return `url(#${linearGradientId})`

    if (data?._connectedNodeIsHovering)
      return getEdgeColor(NodeRunningStatus.Running, sourceHandleId === ErrorHandleTypeEnum.failBranch)

    return getEdgeColor()
  }, [data._connectedNodeIsHovering, linearGradientId, selected, sourceHandleId])

  return (
    <>
      {
        linearGradientId && (
          <CustomEdgeLinearGradientRender
            id={linearGradientId}
            startColor={getEdgeColor(_sourceRunningStatus)}
            stopColor={getEdgeColor(_targetRunningStatus)}
            position={{
              x1: sourceX,
              y1: sourceY,
              x2: targetX,
              y2: targetY,
            }}
          />
        )
      }
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: 2,
          opacity: data._dimmed ? 0.3 : (data._waitingRun ? 0.7 : 1),
          strokeDasharray: data._isTemp ? '8 8' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={cn(
            'nopan nodrag hover:scale-125',
            data?._hovering ? 'block' : 'hidden',
            open && '!block',
            data.isInIteration && `z-[${ITERATION_CHILDREN_Z_INDEX}]`,
            data.isInLoop && `z-[${LOOP_CHILDREN_Z_INDEX}]`,
          )}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            opacity: data._waitingRun ? 0.7 : 1,
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
