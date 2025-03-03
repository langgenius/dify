import React from 'react'
const nodeWidth = 180
const nodeHeight = 60
const CustomSelfLoopEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEndId,
}) => {
  // 手动设置控制点，形成 3/4 圆的路径
  const diff = Math.max(Math.trunc((sourceX - targetX) / nodeWidth), 1)
  const controlX1 = sourceX + (sourceX - targetX) // 控制点1的位置
  const controlY1 = sourceY - diff * nodeHeight * 2
  const controlX2 = sourceX - (sourceX - targetX) * 2 // 控制点2的位置
  const controlY2 = sourceY - diff * nodeHeight * 2

  const edgePath = `M${sourceX},${sourceY} C${controlX1},${controlY1} ${controlX2},${controlY2} ${targetX},${targetY}`
  return (
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path loop"
        d={edgePath}
        markerEnd="url(#arrowhead)"
      />
    </>
  )
}

export default CustomSelfLoopEdge
