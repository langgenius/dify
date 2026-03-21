import type {
  BlockEnum,
  OnSelectBlock,
} from '../../types'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { cn } from '@/utils/classnames'
import BlockSelector from '../../block-selector'
import { useNodesInteractions } from '../../hooks'

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
  const handleInsert = useCallback<OnSelectBlock>((nodeType, pluginDefaultValue) => {
    handleNodeAdd(
      {
        nodeType,
        pluginDefaultValue,
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
