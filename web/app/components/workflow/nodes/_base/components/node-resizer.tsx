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
    <>
      <NodeResizeControl
        position='top-left'
        className='!border-none !bg-transparent'
        onResize={handleResize}
      >
        <Icon className='absolute left-0 top-0' />
      </NodeResizeControl>
      <NodeResizeControl
        position='top-right'
        className='!border-none !bg-transparent'
        onResize={handleResize}
      >
        <Icon className='absolute top-0 right-0 origin-center rotate-90' />
      </NodeResizeControl>
      <NodeResizeControl
        position='bottom-left'
        className='!border-none !bg-transparent'
        onResize={handleResize}
      >
        <div className='absolute left-0 bottom-0 origin-center -rotate-90'><Icon /></div>
      </NodeResizeControl>
      <NodeResizeControl
        position='bottom-right'
        className='!border-none !bg-transparent'
        onResize={handleResize}
      >
        <div className='absolute bottom-0 right-0 origin-center rotate-180'><Icon /></div>
      </NodeResizeControl>
    </>
  )
}

export default memo(NodeResizer)
