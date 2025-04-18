import type { FC } from 'react'
import {
  RiCloseLine,
} from '@remixicon/react'
import { useStore } from '../store'
import Empty from './empty'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

const Panel: FC = () => {
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)

  const isEmpty = true

  if (isEmpty) {
    return (
      <div className={cn('flex h-full flex-col')}>
        <div className='flex shrink-0 items-center justify-between pl-4 pr-2 pt-2'>
          <div className='system-sm-semibold-uppercase'>Variable Inspect</div>
          <ActionButton onClick={() => setShowVariableInspectPanel(false)}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
        <div className='grow p-2'>
          <Empty />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative pb-1')}>
    </div>
  )
}

export default Panel
