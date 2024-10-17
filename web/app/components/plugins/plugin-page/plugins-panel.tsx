'use client'

import List from './list'

const PluginsPanel = () => {
  return (
    <>
      <div className='flex flex-col pt-1 pb-3 px-12 justify-center items-start gap-3 self-stretch'>
        <div className='h-px self-stretch bg-divider-subtle'></div>
        <div className='flex items-center gap-2 self-stretch'>
          {/* Filters go here */}
        </div>
      </div>
      <div className='flex px-12 items-start content-start gap-2 flex-grow self-stretch flex-wrap'>
        <List />
      </div>
    </>
  )
}

export default PluginsPanel
