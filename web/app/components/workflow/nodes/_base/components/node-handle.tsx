import {
  useCallback,
  useState,
} from 'react'
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
  const [open, setOpen] = useState(false)
  const store = useStoreApi()
  const incomers = getIncomers({ id } as Node, store.getState().getNodes(), store.getState().edges)
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = () => {
    if (incomers.length === 0 && data.type !== BlockEnum.Start)
      handleOpenChange(!open)
  }

  return (
    <>
      <Handle
        type='target'
        position={Position.Left}
        className={`
          !top-[17px] !-left-2 !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0 z-[1]
          after:absolute after:w-0.5 after:h-2 after:left-1.5 after:top-1 after:bg-primary-500
          ${!incomers.length && 'after:opacity-0'}
          ${data.type === BlockEnum.Start && 'opacity-0'}
        `}
        isConnectable={data.type !== BlockEnum.Start}
        onClick={handleHandleClick}
      >
        {
          incomers.length === 0 && data.type !== BlockEnum.Start && (
            <BlockSelector
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={() => {}}
              asChild
              placement='left'
              triggerClassName={open => `
                hidden absolute left-0 top-0 pointer-events-none
                ${data.hovering && '!flex'}
                ${open && '!flex'}
              `}
            />
          )
        }
      </Handle>
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
  const [open, setOpen] = useState(false)
  const store = useStoreApi()
  const connectedEdges = getConnectedEdges([{ id } as Node], store.getState().edges)
  const connected = connectedEdges.find(edge => edge.sourceHandle === handleId)
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = () => {
    if (!connected)
      handleOpenChange(!open)
  }

  return (
    <>
      <Handle
        id={handleId}
        type='source'
        position={Position.Right}
        className={`
          !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0 z-[1]
          after:absolute after:w-0.5 after:h-2 after:right-1.5 after:top-1 after:bg-primary-500
          ${!connected && 'after:opacity-0'}
          ${handleClassName}
        `}
        onClick={handleHandleClick}
      >
        {
          !connected && (
            <BlockSelector
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={() => {}}
              asChild
              triggerClassName={open => `
                hidden absolute top-0 left-0 pointer-events-none
                ${nodeSelectorClassName}
                ${data.hovering && '!flex'}
                ${open && '!flex'}
              `}
            />
          )
        }
      </Handle>
    </>
  )
}
