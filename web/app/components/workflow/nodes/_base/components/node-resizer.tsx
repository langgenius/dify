import {
  memo,
  useCallback,
} from 'react'
import type { OnResize } from 'reactflow'
import { NodeResizeControl } from 'reactflow'
import { useNodesInteractions } from '../../../hooks'
import type { CommonNodeType } from '../../../types'
import cn from '@/utils/classnames'

const Icon = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5.19009 11.8398C8.26416 10.6196 10.7144 8.16562 11.9297 5.08904" stroke="black" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

type NodeResizerProps = {
  nodeId: string
  nodeData: CommonNodeType
  icon?: JSX.Element
  minWidth?: number
  minHeight?: number
  maxWidth?: number
}
const NodeResizer = ({
  nodeId,
  nodeData,
  icon = <Icon />,
  minWidth = 258,
  minHeight = 152,
  maxWidth,
}: NodeResizerProps) => {
  const { handleNodeResize } = useNodesInteractions()

  const handleResize = useCallback<OnResize>((_, params) => {
    handleNodeResize(nodeId, params)
  }, [nodeId, handleNodeResize])

  return (
    <div className={cn(
      'hidden group-hover:block',
      nodeData.selected && '!block',
    )}>
      <NodeResizeControl
        position='bottom-right'
        className='!border-none !bg-transparent'
        onResize={handleResize}
        minWidth={minWidth}
        minHeight={minHeight}
        maxWidth={maxWidth}
      >
        <div className='absolute bottom-[1px] right-[1px]'>{icon}</div>
      </NodeResizeControl>
    </div>
  )
}

export default memo(NodeResizer)
