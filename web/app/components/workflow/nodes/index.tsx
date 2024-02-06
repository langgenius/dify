import {
  Handle,
  Position,
} from 'reactflow'
import StartNode from './start/node'

const NodeMap = {
  'start-node': StartNode,
}

const CustomNode = () => {
  return (
    <>
      <Handle
        type='target'
        position={Position.Top}
        className='!-top-0.5 !w-2 !h-0.5 !bg-primary-500 !rounded-none !border-none !min-h-[2px]'
      />
      <StartNode />
      <Handle
        type='source'
        position={Position.Bottom}
        className='!-bottom-0.5 !w-2 !h-0.5 !bg-primary-500 !rounded-none !border-none !min-h-[2px]'
      />
    </>
  )
}

export default CustomNode
