import React from 'react'
import { RiInfoI } from '@remixicon/react'

type TooltipProps = {
  content: string
}

const Tooltip = ({
  content,
}: TooltipProps) => {
  return (
    <div className='group relative z-10 size-[18px] overflow-visible'>
      <div className='system-xs-regular absolute bottom-0 right-0 -z-10 hidden w-[260px] bg-saas-dify-blue-static px-5 py-[18px] text-text-primary-on-surface group-hover:block'>
        {content}
      </div>
      <div className='flex h-full w-full items-center justify-center rounded-[4px] bg-state-base-hover transition-all duration-500 ease-in-out group-hover:rounded-none group-hover:bg-saas-dify-blue-static'>
        <RiInfoI className='size-3.5 text-text-tertiary group-hover:text-text-primary-on-surface' />
      </div>
    </div>
  )
}

export default React.memo(Tooltip)
