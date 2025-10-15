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

type BlockMemoryProps = {
  payload: Memory
}
const BlockMemory = ({ payload }: BlockMemoryProps) => {
  const { t } = useTranslation()
  const { block_id } = payload
  const { memoryVariablesInUsed } = useMemoryVariables(block_id || [])
  const [showConfirm, setShowConfirm] = useState<{
    title: string
    desc: string
    onConfirm: () => void
  } | undefined>(undefined)

  const handleEdit = (blockId: string) => {
    console.log('edit', blockId)
  }

  const handleDelete = (blockId: string) => {
    setShowConfirm({
      title: t('workflow.nodes.common.memory.block.deleteConfirmTitle'),
      desc: t('workflow.nodes.common.memory.block.deleteConfirmDesc'),
      onConfirm: () => handleDelete(blockId),
    })
  }

  if (!block_id?.length) {
    return (
      <div className='system-xs-regular mt-2 flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>
        {t('workflow.nodes.common.memory.block.empty')}
      </div>
    )
  }
  return (
    <>
      <div>
        {
          memoryVariablesInUsed.map(memoryVariable => (
            <div
              key={memoryVariable.id}
              className='group flex h-8 items-center space-x-1 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-2 pr-1 shadow-xs hover:border hover:border-state-destructive-solid hover:bg-state-destructive-hover'>
              <div className='h-4 w-4'></div>
              <div
                title={memoryVariable.name}
                className='system-sm-medium grow truncate text-text-secondary'
              >
                {memoryVariable.name}
              </div>
              <Badge className='shrink-0'>
                {memoryVariable.term}
              </Badge>
              <ActionButton
                className='hidden shrink-0 group-hover:block'
                size='m'
                onClick={() => handleEdit(memoryVariable.id)}
              >
                <RiEditLine className='h-4 w-4 text-text-tertiary' />
              </ActionButton>
              <ActionButton
                className='hidden shrink-0 group-hover:block'
                size='m'
                onClick={() => handleDelete(memoryVariable.id)}
              >
                <RiDeleteBinLine className='h-4 w-4 text-text-destructive' />
              </ActionButton>
            </div>
          ))
        }
      </div>
      {
        !!showConfirm && (
          <Confirm
            isShow
            onCancel={() => setShowConfirm(undefined)}
            onConfirm={showConfirm.onConfirm}
            title={showConfirm.title}
            content={showConfirm.desc}
          />
        )
      }
    </>
  )
}

export default memo(BlockMemory)
