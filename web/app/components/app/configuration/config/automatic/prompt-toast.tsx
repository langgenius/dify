import { RiCloseLine, RiInformation2Fill } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import React from 'react'
import cn from '@/utils/classnames'
type Props = {
  className?: string
}
const PromptToast = ({
  className,
}: Props) => {
  const [isHide, {
    setTrue: hide,
  }] = useBoolean(false)
  if(isHide)
    return
  return (
    <div className={cn('relative flex h-10 items-center p-2 ', className)}>
      {/* Background Effect */}
      <div className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(92deg,rgba(11,165,236,0.25)_0%,rgba(255,255,255,0.00)_100%)] opacity-40 shadow-md"></div>
      <div className='relative flex h-full w-full items-center justify-between'>
        <div className="flex h-full items-center gap-1">
          <RiInformation2Fill className="size-4 text-text-accent" />
          <p className="text-sm text-gray-700">This is the modified prompt with added context.</p>
        </div>

        <div className='cursor-pointer p-0.5' onClick={hide}>
          <RiCloseLine className='size-5 text-text-tertiary' />
        </div>
      </div>
    </div>
  )
}

export default PromptToast
