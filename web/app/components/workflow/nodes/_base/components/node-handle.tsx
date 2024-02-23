import type { NodeProps } from 'reactflow'
import {
  Handle,
  Position,
  getConnectedEdges,
  getIncomers,
  useStoreApi,
} from 'reactflow'
import { BlockEnum } from '../../../types'
import type { Node } from '../../../types'
import BlockSelector from '../../../block-selector'

export const NodeTargetHandle = ({
  id,
  data,
}: NodeProps) => {
  const store = useStoreApi()
  const incomers = getIncomers({ id } as Node, store.getState().getNodes(), store.getState().edges)

  return (
    <>
      <Handle
        type='target'
        position={Position.Left}
        className={`
          !top-[17px] !left-0 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0 z-[1]
          after:absolute after:w-0.5 after:h-2 after:-left-0.5 after:top-1 after:bg-primary-500
          ${(data.type === BlockEnum.Start || !incomers.length) && 'opacity-0'}
        `}
        isConnectable={data.type !== BlockEnum.Start}
      />
      {
        incomers.length === 0 && data.type !== BlockEnum.Start && (
          <BlockSelector
            onSelect={() => {}}
            asChild
            placement='left'
            triggerClassName={open => `
              hidden absolute -left-2 top-4
              ${data.hovering && '!flex'}
              ${open && '!flex'}
            `}
          />
        )
      }
    </>
  )
}

type NodeSourceHandleProps = {
  handleId?: string
  handleClassName?: string
  nodeSelectorClassName?: string
} & Pick<NodeProps, 'id' | 'data'>
export const NodeSourceHandle = ({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
}: NodeSourceHandleProps) => {
  const store = useStoreApi()
  const connectedEdges = getConnectedEdges([{ id } as Node], store.getState().edges)
  const connected = connectedEdges.find(edge => edge.sourceHandle === handleId)

  return (
    <>
      <Handle
        id={handleId}
        type='source'
        position={Position.Right}
        className={`
          !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0 z-[1]
          after:absolute after:w-0.5 after:h-2 after:-right-0.5 after:top-1 after:bg-primary-500
          ${!connected && 'opacity-0'}
          ${handleClassName}
        `}
      />
      {
        !connected && (
          <BlockSelector
            onSelect={() => {}}
            asChild
            triggerClassName={open => `
              hidden
              ${nodeSelectorClassName}
              ${data.hovering && '!flex'}
              ${open && '!flex'}
            `}
          />
        )
      }
    </>
  )
}
