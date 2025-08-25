import React from 'react'

const Slice = React.memo(() => {
  return (
    <div className='flex flex-col gap-y-1'>
      <div className='flex h-5 w-full items-center bg-state-base-hover'>
        <span className='h-5 w-[30px] bg-state-base-hover-alt' />
      </div>
      <div className='h-5 w-2/3 bg-state-base-hover' />
    </div>
  )
})

Slice.displayName = 'Slice'

const FullDocListSkeleton = () => {
  return (
    <div className='relative z-10 flex w-full grow flex-col gap-y-3 overflow-y-hidden'>
      <div className='absolute bottom-14 left-0 top-0 z-20 h-full w-full bg-dataset-chunk-list-mask-bg' />
      {Array.from({ length: 15 }).map((_, index) => <Slice key={index} />)}
    </div>
  )
}

export default React.memo(FullDocListSkeleton)
