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
        'relative flex flex-col w-[420px] bg-components-panel-bg-alt rounded-l-2xl h-full border border-components-panel-border',
      )}
    >
      <div className='shrink-0 flex items-center justify-between p-4 pb-0 text-text-primary system-xl-semibold'>
        Global Variables(Current not show)
        <div className='flex items-center'>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={() => setShowPanel(false)}
          >
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='shrink-0 py-1 px-4 system-sm-regular text-text-tertiary'>...</div>

      <div className='grow px-4 rounded-b-2xl overflow-y-auto'>
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
