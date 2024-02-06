import type { EdgeProps } from 'reactflow'
import {
  BaseEdge,
  getBezierPath,
} from 'reactflow'

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  })
  console.log('edgePath', edgePath)

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
    </>
  )
}

export default CustomEdge
