import type { EdgeProps } from 'reactflow'
import {
  memo,
  useMemo,
} from 'react'
import {
  BaseEdge,
  getBezierPath,
  Position,
} from 'reactflow'
import CustomEdgeLinearGradientRender from '@/app/components/workflow/custom-edge-linear-gradient-render'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { getEdgeColor } from '@/app/components/workflow/utils'

const CustomEdge = ({
  id,
  data,
  sourceHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
}: EdgeProps) => {
  const [
    edgePath,
  ] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })
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
    ) {
      return id
    }
  }, [_sourceRunningStatus, _targetRunningStatus, id])

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
          opacity: data._waitingRun ? 0.7 : 1,
        }}
      />
    </>
  )
}

export default memo(CustomEdge)
