import {
  memo,
  useCallback,
} from 'react'
import type { OnResize } from 'reactflow'
import { NodeResizeControl } from 'reactflow'
import { useNodesInteractions } from '../../../hooks'

type IconProps = {
  className?: string
}
const Icon = ({
  className,
}: IconProps) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10.8919 4.15967C7.81787 5.37996 5.36767 7.83389 4.15234 10.9105" stroke="black" strokeOpacity="0.08" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

type NodeResizerProps = {
  nodeId: string
}
const NodeResizer = ({
  nodeId,
}: NodeResizerProps) => {
  const { handleNodeResize } = useNodesInteractions()

  const handleResize = useCallback<OnResize>((_, params) => {
    handleNodeResize(nodeId, params)
  }, [nodeId, handleNodeResize])

  return (
    <div className='hidden group-hover:block'>
      <NodeResizeControl
        position='bottom-right'
        className='!border-none !bg-transparent'
        onResize={handleResize}
        minWidth={272}
        minHeight={176}
      >
        <div className='absolute bottom-0 right-0 origin-center rotate-180'><Icon /></div>
      </NodeResizeControl>
    </div>
  )
}

export default memo(NodeResizer)
