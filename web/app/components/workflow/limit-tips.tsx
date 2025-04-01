import {
  RiAlertFill,
  RiCloseLine,
} from '@remixicon/react'
import { useStore } from './store'
import ActionButton from '@/app/components/base/action-button'

const LimitTips = () => {
  const showTips = useStore(s => s.showTips)
  const setShowTips = useStore(s => s.setShowTips)

  if (!showTips)
    return null

  return (
    <div className='absolute bottom-16 left-1/2 z-[9] flex h-10 -translate-x-1/2 items-center rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-2 shadow-md'>
      <div
        className='absolute inset-0 rounded-xl opacity-[0.4]'
        style={{
          background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)',
        }}
      ></div>
      <div className='flex h-5 w-5 items-center justify-center'>
        <RiAlertFill className='h-4 w-4 text-text-warning-secondary' />
      </div>
      <div className='system-xs-medium mx-1 px-1 text-text-primary'>
        {showTips}
      </div>
      <ActionButton
        className='z-[1]'
        onClick={() => setShowTips('')}
      >
        <RiCloseLine className='h-4 w-4' />
      </ActionButton>
    </div>
  )
}

export default LimitTips
