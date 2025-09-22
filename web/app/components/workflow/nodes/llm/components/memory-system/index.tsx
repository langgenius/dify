import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import type {
  Node,
} from '@/app/components/workflow/types'
import Divider from '@/app/components/base/divider'
import Tooltip from '@/app/components/base/tooltip'
import MemoryCreateButton from './memory-create-button'
import MemorySelector from './memory-selector'
import LinearMemory from './linear-memory'
import type { Memory } from '@/app/components/workflow/types'
import type { LLMNodeType } from '../../types'
import { useMemory } from './hooks'
import Split from '@/app/components/workflow/nodes/_base/components/split'

type MemoryProps = Pick<Node, 'id' | 'data'> & {
  readonly?: boolean
  canSetRoleName?: boolean
}
const MemorySystem = ({
  id,
  data,
  readonly,
  canSetRoleName,
}: MemoryProps) => {
  const { t } = useTranslation()
  const { memory } = data as LLMNodeType
  const {
    collapsed,
    setCollapsed,
    handleMemoryTypeChange,
    memoryType,
    handleUpdateMemory,
  } = useMemory(id, data as LLMNodeType)

  return (
    <>
      <div className=''>
        <Collapse
          disabled={!memory?.enabled}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          hideCollapseIcon
          triggerClassName='ml-0 system-sm-semibold-uppercase'
          trigger={
            collapseIcon => (
              <div className='flex grow items-center justify-between'>
                <div className='flex items-center'>
                  <div className='system-sm-semibold-uppercase mr-0.5 text-text-secondary'>
                    {t('workflow.nodes.common.memory.memory')}
                  </div>
                  <Tooltip
                    popupContent={t('workflow.nodes.common.memory.memoryTip')}
                    triggerClassName='w-4 h-4'
                  />
                  {collapseIcon}
                  <Divider type='vertical' className='!ml-1.5 !mr-1 h-3 !w-px bg-divider-regular' />
                  <div onClick={e => e.stopPropagation()}>
                    <MemoryCreateButton />
                  </div>
                </div>
                <MemorySelector
                  value={memoryType}
                  onSelected={handleMemoryTypeChange}
                  readonly={readonly}
                />
              </div>
            )}
        >
          <>
            {
              memoryType === 'linear' && !collapsed && (
                <LinearMemory
                  className='mt-2'
                  payload={memory as Memory}
                  onChange={handleUpdateMemory}
                  readonly={readonly}
                  canSetRoleName={canSetRoleName}
                />
              )
            }
          </>
        </Collapse>
        <Split className='mt-4' />
      </div>
    </>
  )
}

export default memo(MemorySystem)
