import type { MouseEvent } from 'react'
import {
  useCallback,
  useState,
} from 'react'
import type { NodeProps } from 'reactflow'
import {
  Handle,
  Position,
  getConnectedEdges,
  useEdges,
} from 'reactflow'
import { BlockEnum } from '../../../types'
import type { Node } from '../../../types'
import BlockSelector from '../../../block-selector'
import { useWorkflow } from '../../../hooks'

type NodeHandleProps = {
  handleId: string
  handleClassName?: string
  nodeSelectorClassName?: string
} & Pick<NodeProps, 'id' | 'data'>

export const NodeTargetHandle = ({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
}: NodeHandleProps) => {
  const [open, setOpen] = useState(false)
  const edges = useEdges()
  const connectedEdges = getConnectedEdges([{ id } as Node], edges)
  const connected = connectedEdges.find(edge => edge.targetHandle === handleId && edge.target === id)

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    if (!connected)
      setOpen(v => !v)
  }, [connected])

  return (
    <>
      <Handle
        id={handleId}
        type='target'
        position={Position.Left}
        className={`
          !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none !translate-y-0 z-[1]
          after:absolute after:w-0.5 after:h-2 after:left-1.5 after:top-1 after:bg-primary-500
          ${!connected && 'after:opacity-0'}
          ${data.type === BlockEnum.Start && 'opacity-0'}
          ${handleClassName}
        `}
        isConnectable={data.type !== BlockEnum.Start}
        onClick={handleHandleClick}
      >
        {
          !connected && data.type !== BlockEnum.Start && (
            <BlockSelector
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={() => {}}
              asChild
              placement='left'
              triggerClassName={open => `
                hidden absolute left-0 top-0 pointer-events-none
                ${nodeSelectorClassName}
                ${data._hovering && '!flex'}
                ${open && '!flex'}
              `}
            />
          )
        }
      </Handle>
    </>
  )
}

export const NodeSourceHandle = ({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
}: NodeHandleProps) => {
  const [open, setOpen] = useState(false)
  const { handleNodeAddNext } = useWorkflow()
  const edges = useEdges()
  const connectedEdges = getConnectedEdges([{ id } as Node], edges)
  const connected = connectedEdges.find(edge => edge.sourceHandle === handleId && edge.source === id)
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    if (!connected)
      setOpen(v => !v)
  }, [connected])
  const handleSelect = useCallback((type: BlockEnum) => {
    handleNodeAddNext(id, type, handleId)
  }, [handleNodeAddNext, id, handleId])

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
              onSelect={handleSelect}
              asChild
              triggerClassName={open => `
                hidden absolute top-0 left-0 pointer-events-none
                ${nodeSelectorClassName}
                ${data._hovering && '!flex'}
                ${open && '!flex'}
              `}
            />
          )
        }
      </Handle>
    </>
  )
}
