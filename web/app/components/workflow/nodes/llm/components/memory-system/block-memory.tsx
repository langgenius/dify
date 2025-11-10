import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import type { Memory } from '@/app/components/workflow/types'
import Badge from '@/app/components/base/badge'
import ActionButton from '@/app/components/base/action-button'
import { useMemoryVariables } from './hooks/use-memory-variables'
import Confirm from '@/app/components/base/confirm'
import { Memory as MemoryIcon } from '@/app/components/base/icons/src/vender/line/others'
import VariableModal from '@/app/components/workflow/panel/chat-variable-panel/components/variable-modal'
import cn from '@/utils/classnames'

type BlockMemoryProps = {
  id: string
  payload: Memory
}
const BlockMemory = ({ id }: BlockMemoryProps) => {
  const { t } = useTranslation()
  const [destructiveItemId, setDestructiveItemId] = useState<string | undefined>(undefined)
  const {
    memoryVariablesInUsed,
    editMemoryVariable,
    handleSetEditMemoryVariable,
    handleEdit,
    handleDelete,
    handleDeleteConfirm,
    cacheForDeleteMemoryVariable,
    setCacheForDeleteMemoryVariable,
  } = useMemoryVariables(id)

  if (!memoryVariablesInUsed?.length) {
    return (
      <div className='system-xs-regular mt-2 flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>
        {t('workflow.nodes.common.memory.block.empty')}
      </div>
    )
  }
  return (
    <>
      <div className='mt-2 space-y-1'>
        {
          memoryVariablesInUsed.map(memoryVariable => (
            <div
              key={memoryVariable.id}
              className={cn(
                'group flex h-8 items-center space-x-1 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-2 pr-1 shadow-xs',
                destructiveItemId === memoryVariable.id && 'border border-state-destructive-solid bg-state-destructive-hover',
              )}>
              <MemoryIcon className='h-4 w-4 text-util-colors-teal-teal-700' />
              <div
                title={memoryVariable.name}
                className='system-sm-medium grow truncate text-text-secondary'
              >
                {memoryVariable.name}
              </div>
              <Badge className={cn('shrink-0 group-hover:hidden', editMemoryVariable?.id === memoryVariable.id && 'hidden')}>
                {memoryVariable.term}
              </Badge>
              <ActionButton
                className={cn(
                  'hidden shrink-0 group-hover:inline-flex',
                  editMemoryVariable?.id === memoryVariable.id && 'inline-flex bg-state-base-hover text-text-secondary',
                )}
                size='m'
                onClick={() => handleSetEditMemoryVariable(memoryVariable.id)}
              >
                <RiEditLine className='h-4 w-4 text-text-tertiary' />
              </ActionButton>
              <ActionButton
                className={cn(
                  'hidden shrink-0 bg-transparent hover:bg-transparent hover:text-text-destructive group-hover:inline-flex',
                  editMemoryVariable?.id === memoryVariable.id && 'inline-flex',
                )}
                size='m'
                onClick={() => handleDelete(memoryVariable)}
                onMouseOver={() => setDestructiveItemId(memoryVariable.id)}
                onMouseOut={() => setDestructiveItemId(undefined)}
              >
                <RiDeleteBinLine className={cn('h-4 w-4', destructiveItemId === memoryVariable.id && 'text-text-destructive')} />
              </ActionButton>
            </div>
          ))
        }
      </div>
      {
        !!cacheForDeleteMemoryVariable && (
          <Confirm
            isShow
            onCancel={() => setCacheForDeleteMemoryVariable(undefined)}
            onConfirm={() => handleDeleteConfirm(cacheForDeleteMemoryVariable.id)}
            title={t('workflow.nodes.common.memory.deleteNodeMemoryVariableConfirmTitle', { name: cacheForDeleteMemoryVariable.name })}
            content={t('workflow.nodes.common.memory.deleteNodeMemoryVariableConfirmDesc')}
          />
        )
      }
      {
        !!editMemoryVariable && (
          <VariableModal
            chatVar={editMemoryVariable}
            onClose={() => handleSetEditMemoryVariable(undefined)}
            onSave={handleEdit}
            nodeScopeMemoryVariable={{ nodeId: id }}
          />
        )
      }
    </>
  )
}

export default memo(BlockMemory)
