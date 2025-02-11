import React from 'react'

const Slice = React.memo(() => {
  return (
    <div className='flex flex-col gap-y-1'>
      <div className='w-full h-5 bg-state-base-hover flex items-center'>
        <span className='w-[30px] h-5 bg-state-base-hover-alt' />
      </div>
      <div className='w-2/3 h-5 bg-state-base-hover' />
    </div>
  )
})

Slice.displayName = 'Slice'

const FullDocListSkeleton = () => {
  return (
    <div className='w-full grow flex flex-col gap-y-3 relative z-10 overflow-y-hidden'>
      <div className='absolute top-0 left-0 bottom-14 w-full h-full bg-dataset-chunk-list-mask-bg z-20' />
      {[...Array(15)].map((_, index) => <Slice key={index} />)}
    </div>
  )
}

export default React.memo(FullDocListSkeleton)
