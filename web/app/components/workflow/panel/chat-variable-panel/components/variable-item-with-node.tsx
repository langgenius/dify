import { memo } from 'react'
import { useStore } from 'reactflow'
import VariableItem from './variable-item'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { MemoryVariable } from '@/app/components/workflow/types'

type VariableItemWithNodeProps = {
  nodeId: string
  memoryVariables: MemoryVariable[]
  onEdit: (memoryVariable: MemoryVariable) => void
  onDelete: (memoryVariable: MemoryVariable) => void
  currentVarId?: string
}
const VariableItemWithNode = ({
  nodeId,
  memoryVariables,
  onEdit,
  onDelete,
  currentVarId,
}: VariableItemWithNodeProps) => {
  const currentNode = useStore(s => s.nodeInternals.get(nodeId))

  if (!currentNode) return null

  return (
    <div className='space-y-1 py-1'>
      <div className='mb-1 flex items-center'>
        <BlockIcon className='mr-1.5 shrink-0' type={BlockEnum.LLM} />
        <div
          className='system-sm-medium grow truncate text-text-secondary'
          title={currentNode?.data.title}
        >
          {currentNode?.data.title}
        </div>
      </div>
      {
        memoryVariables.map(memoryVariable => (
          <VariableItem
            key={memoryVariable.id}
            item={memoryVariable}
            onEdit={onEdit}
            onDelete={onDelete}
            scope='node'
            term={memoryVariable.term}
            currentVarId={currentVarId}
          />
        ))
      }
    </div>
  )
}

export default memo(VariableItemWithNode)
