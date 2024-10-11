'use client'

import { RiDragDropLine } from '@remixicon/react'

const PluginsPanel = () => {
  return (
    <>
      <div className='flex flex-col pt-1 pb-3 px-12 justify-center items-start gap-3 self-stretch'>
        <div className='h-px self-stretch bg-divider-subtle'></div>
        <div className='flex items-center gap-2 self-stretch'>
          {/* Filter goes here */}
        </div>
      </div>
      <div className='flex px-12 items-start content-start gap-2 flex-grow self-stretch flex-wrap'>
        {/* Plugin cards go here */}
      </div>
      <div className='flex items-center justify-center py-4 gap-2 text-text-quaternary'>
        <RiDragDropLine className='w-4 h-4' />
        <span className='system-xs-regular'>Drop plugin package here to install</span>
      </div>
    </>
  )
}

export default PluginsPanel
