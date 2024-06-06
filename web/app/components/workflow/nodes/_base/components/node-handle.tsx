import type { MouseEvent } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  Handle,
  Position,
} from 'reactflow'
import { BlockEnum } from '../../../types'
import type { Node } from '../../../types'
import BlockSelector from '../../../block-selector'
import type { ToolDefaultValue } from '../../../block-selector/types'
import {
  useAvailableBlocks,
  useNodesInteractions,
  useNodesReadOnly,
} from '../../../hooks'
import { useStore } from '../../../store'

type NodeHandleProps = {
  handleId: string
  handleClassName?: string
  nodeSelectorClassName?: string
} & Pick<Node, 'id' | 'data'>

export const NodeTargetHandle = memo(({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
}: NodeHandleProps) => {
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { getNodesReadOnly } = useNodesReadOnly()
  const connected = data._connectedTargetHandleIds?.includes(handleId)
  const { availablePrevBlocks } = useAvailableBlocks(data.type, data.isInIteration)
  const isConnectable = !!availablePrevBlocks.length && (
    !data.isIterationStart
  )

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    if (!connected)
      setOpen(v => !v)
  }, [connected])
  const handleSelect = useCallback((type: BlockEnum, toolDefaultValue?: ToolDefaultValue) => {
    handleNodeAdd(
      {
        nodeType: type,
        toolDefaultValue,
      },
      {
        nextNodeId: id,
        nextNodeTargetHandle: handleId,
      },
    )
  }, [handleNodeAdd, id, handleId])

  return (
    <>
      <Handle
        id={handleId}
        type='target'
        position={Position.Left}
        className={`
          !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none z-[1]
          after:absolute after:w-0.5 after:h-2 after:left-1.5 after:top-1 after:bg-primary-500
          hover:scale-125 transition-all
          ${!connected && 'after:opacity-0'}
          ${data.type === BlockEnum.Start && 'opacity-0'}
          ${handleClassName}
        `}
        isConnectable={isConnectable}
        onClick={handleHandleClick}
      >
        {
          !connected && isConnectable && !getNodesReadOnly() && (
            <BlockSelector
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={handleSelect}
              asChild
              placement='left'
              triggerClassName={open => `
                hidden absolute left-0 top-0 pointer-events-none
                ${nodeSelectorClassName}
                group-hover:!flex
                ${data.selected && '!flex'}
                ${open && '!flex'}
              `}
              availableBlocksTypes={availablePrevBlocks}
            />
          )
        }
      </Handle>
    </>
  )
})
NodeTargetHandle.displayName = 'NodeTargetHandle'

export const NodeSourceHandle = memo(({
  id,
  data,
  handleId,
  handleClassName,
  nodeSelectorClassName,
}: NodeHandleProps) => {
  const notInitialWorkflow = useStore(s => s.notInitialWorkflow)
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInIteration)
  const isConnectable = !!availableNextBlocks.length

  const connected = data._connectedSourceHandleIds?.includes(handleId)
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleHandleClick = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    if (!connected)
      setOpen(v => !v)
  }, [connected])
  const handleSelect = useCallback((type: BlockEnum, toolDefaultValue?: ToolDefaultValue) => {
    handleNodeAdd(
      {
        nodeType: type,
        toolDefaultValue,
      },
      {
        prevNodeId: id,
        prevNodeSourceHandle: handleId,
      },
    )
  }, [handleNodeAdd, id, handleId])

  useEffect(() => {
    if (notInitialWorkflow && data.type === BlockEnum.Start)
      setOpen(true)
  }, [notInitialWorkflow, data.type])

  return (
    <>
      <Handle
        id={handleId}
        type='source'
        position={Position.Right}
        className={`
          !w-4 !h-4 !bg-transparent !rounded-none !outline-none !border-none z-[1]
          after:absolute after:w-0.5 after:h-2 after:right-1.5 after:top-1 after:bg-primary-500
          hover:scale-125 transition-all
          ${!connected && 'after:opacity-0'}
          ${handleClassName}
        `}
        isConnectable={isConnectable}
        onClick={handleHandleClick}
      >
        {
          !connected && isConnectable && !getNodesReadOnly() && (
            <BlockSelector
              open={open}
              onOpenChange={handleOpenChange}
              onSelect={handleSelect}
              asChild
              triggerClassName={open => `
                hidden absolute top-0 left-0 pointer-events-none 
                ${nodeSelectorClassName}
                group-hover:!flex
                ${data.selected && '!flex'}
                ${open && '!flex'}
              `}
              availableBlocksTypes={availableNextBlocks}
            />
          )
        }
      </Handle>
    </>
  )
})
NodeSourceHandle.displayName = 'NodeSourceHandle'
