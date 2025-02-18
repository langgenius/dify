import React from 'react'

const Slice = React.memo(() => {
  return (
    <div className='flex flex-col gap-y-1'>
      <div className='bg-state-base-hover flex h-5 w-full items-center'>
        <span className='bg-state-base-hover-alt h-5 w-[30px]' />
      </div>
      <div className='bg-state-base-hover h-5 w-2/3' />
    </div>
  )
})

Slice.displayName = 'Slice'

const FullDocListSkeleton = () => {
  return (
    <div className='relative z-10 flex w-full grow flex-col gap-y-3 overflow-y-hidden'>
      <div className='bg-dataset-chunk-list-mask-bg absolute bottom-14 left-0 top-0 z-20 h-full w-full' />
      {[...Array.from({ length: 15 })].map((_, index) => <Slice key={index} />)}
    </div>
  )
}

export default React.memo(FullDocListSkeleton)
