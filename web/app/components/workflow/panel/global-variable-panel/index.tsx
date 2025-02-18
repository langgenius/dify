import {
  memo,
} from 'react'

import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { GlobalVariable } from '../../types'
import Item from './item'
import { useStore } from '@/app/components/workflow/store'

import cn from '@/utils/classnames'

const Panel = () => {
  const { t } = useTranslation()
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
        'bg-components-panel-bg-alt border-components-panel-border relative flex h-full w-[420px] flex-col rounded-l-2xl border',
      )}
    >
      <div className='text-text-primary system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0'>
        Global Variables(Current not show)
        <div className='flex items-center'>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={() => setShowPanel(false)}
          >
            <RiCloseLine className='text-text-tertiary h-4 w-4' />
          </div>
        </div>
      </div>
      <div className='system-sm-regular text-text-tertiary shrink-0 px-4 py-1'>...</div>

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
