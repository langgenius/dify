import type { FC } from 'react'
import { useState } from 'react'
import {
  RiCloseLine,
} from '@remixicon/react'
import { useStore } from '../store'
import Empty from './empty'
import Left from './left'
import Right from './right'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

const Panel: FC = () => {
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const [showLeftPanel, setShowLeftPanel] = useState(true)

  const isEmpty = false
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
    <div className={cn('relative flex h-full')}>
      {/* left */}
      {bottomPanelWidth < 488 && showLeftPanel && <div className='absolute left-0 top-0 h-full w-full' onClick={() => setShowLeftPanel(false)}></div>}
      <div
        className={cn(
          'w-60 shrink-0 border-r border-divider-burn',
          bottomPanelWidth < 488
            ? showLeftPanel
              ? 'absolute left-0 top-0 z-10 h-full w-[217px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-sm'
              : 'hidden'
            : 'block',
        )}
      >
        <Left handleMenuClick={setShowLeftPanel} />
      </div>
      {/* right */}
      <div className='w-0 grow'>
        <Right handleOpenMenu={() => setShowLeftPanel(true)} />
      </div>
    </div>
  )
}

export default Panel
