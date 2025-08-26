import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import type {
  Node,
} from '@/app/components/workflow/types'
import Tooltip from '@/app/components/base/tooltip'
import MemorySelector from './memory-selector'
import LinearMemory from './linear-memory'
import type { Memory } from '@/app/components/workflow/types'
import type { LLMNodeType } from '../../types'
import { useMemory } from './hooks'

type MemoryProps = Pick<Node, 'id' | 'data'>
const MemorySystem = ({
  id,
  data,
}: MemoryProps) => {
  const { t } = useTranslation()
  const { memory } = data as LLMNodeType
  const {
    collapsed,
    setCollapsed,
    handleMemoryTypeChange,
  } = useMemory(id, data as LLMNodeType)

  return (
    <>
      <div className='py-4'>
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
                    {t('workflow.nodes.common.errorHandle.title')}
                  </div>
                  <Tooltip
                    popupContent={t('workflow.nodes.common.errorHandle.tip')}
                    triggerClassName='w-4 h-4'
                  />
                  {collapseIcon}
                </div>
                <MemorySelector
                  value='linear'
                  onSelected={handleMemoryTypeChange}
                />
              </div>
            )}
        >
          <>
            {
              (memory?.mode === 'linear' || !memory?.mode) && !collapsed && (
                <LinearMemory
                  payload={memory as Memory}
                  onChange={() => {
                    console.log('onChange')
                  }}
                />
              )
            }
          </>
        </Collapse>
      </div>
    </>
  )
}

export default memo(MemorySystem)
