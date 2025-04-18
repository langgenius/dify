import type { FC } from 'react'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

const Empty: FC = () => {
  return (
    <div className='flex h-full flex-col gap-3 rounded-xl bg-background-section p-8'>
      <div className='flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm'>
        <Variable02 className='h-5 w-5 text-text-accent' />
      </div>
      <div className='flex flex-col gap-1'>
        <div className='system-sm-semibold text-text-secondary'>Variable Inspect</div>
        <div className='system-xs-regular text-text-tertiary'>No variables to inspect</div>
        <a className='system-xs-regular cursor-pointer text-text-accent'>Learn more</a>
      </div>
    </div>
  )
}

export default Empty
