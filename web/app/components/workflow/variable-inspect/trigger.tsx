import type { FC } from 'react'
import { RiLoader2Line, RiStopCircleFill } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

const VariableInspectTrigger: FC = () => {
  return (
    <div className={cn('flex items-center gap-1')}>
      {/* view button */}
      <div
        className='system-2xs-semibold-uppercase flex h-5 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-tertiary shadow-lg backdrop-blur-sm hover:bg-background-default-hover'
        // onClick={() => {}}
      >
        Variable inspect
      </div>
      {/* caching button */}
      <div
        className='system-xs-medium flex h-6 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-accent shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
        // onClick={() => {}}
      >
        <RiLoader2Line className='h-4 w-4' />
        <span className='text-text-accent'>Caching running status</span>
      </div>
      {/* stop button */}
      <Tooltip
        popupContent={'Stop run'}
      >
        <div
          className='flex h-6 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
          // onClick={() => {}}
        >
          <RiStopCircleFill className='h-4 w-4 text-text-accent' />
        </div>
      </Tooltip>
      {/* finish button */}
      <div
        className='system-xs-medium flex h-6 cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 text-text-accent shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent'
        // onClick={() => {}}
      >
        View cached variables
      </div>
      {/* clear button */}
      <div
        className='system-xs-medium flex h-6 cursor-pointer items-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-1 text-text-tertiary shadow-lg backdrop-blur-sm hover:bg-components-actionbar-bg-accent hover:text-text-accent'
        // onClick={() => {}}
      >
        Clear
      </div>
    </div>
  )
}

export default VariableInspectTrigger
