import {
  memo,
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import { useNodesInteractions } from '../../hooks'
import type {
  BlockEnum,
  OnSelectBlock,
} from '../../types'
import BlockSelector from '../../block-selector'

type InsertBlockProps = {
  startNodeId: string
  availableBlocksTypes: BlockEnum[]
}
const InsertBlock = ({
  startNodeId,
  availableBlocksTypes,
}: InsertBlockProps) => {
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])
  const handleInsert = useCallback<OnSelectBlock>((nodeType, toolDefaultValue) => {
    handleNodeAdd(
      {
        nodeType,
        toolDefaultValue,
      },
      {
        nextNodeId: startNodeId,
        nextNodeTargetHandle: 'target',
      },
    )
  }, [startNodeId, handleNodeAdd])

  return (
    <div
      className={cn(
        'nopan nodrag',
        'absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 group-hover/insert:block',
        open && '!block',
      )}
    >
      <BlockSelector
        open={open}
        onOpenChange={handleOpenChange}
        asChild
        onSelect={handleInsert}
        availableBlocksTypes={availableBlocksTypes}
        triggerClassName={() => 'hover:scale-125 transition-all'}
      />
    </div>
  )
}

export default memo(InsertBlock)
