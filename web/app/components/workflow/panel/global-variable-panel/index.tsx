import {
  memo,
} from 'react'

import { RiCloseLine } from '@remixicon/react'
import type { GlobalVariable } from '../../types'
import Item from './item'
import { useStore } from '@/app/components/workflow/store'

import cn from '@/utils/classnames'

const Panel = () => {
  const setShowPanel = useStore(s => s.setShowGlobalVariablePanel)

  const globalVariableList: GlobalVariable[] = [
    {
      name: 'conversation_id',
      value_type: 'string',
      description: 'conversation id',
    },
  ]

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className='system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary'>
        Global Variables(Current not show)
        <div className='flex items-center'>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={() => setShowPanel(false)}
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='system-sm-regular shrink-0 px-4 py-1 text-text-tertiary'>...</div>

      <div className='grow overflow-y-auto rounded-b-2xl px-4'>
        {globalVariableList.map(item => (
          <Item
            key={item.name}
            payload={item}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(Panel)
