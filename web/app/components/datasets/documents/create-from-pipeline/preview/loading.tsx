import React from 'react'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'

const Loading = () => {
  return (
    <div className='flex h-full w-full flex-col gap-y-3 overflow-hidden bg-gradient-to-b from-components-panel-bg-transparent to-components-panel-bg px-6 py-5'>
      <SkeletonContainer className='w-full gap-0'>
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-3/5' />
      </SkeletonContainer>
      <SkeletonContainer className='w-full gap-0'>
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-[70%]' />
      </SkeletonContainer>
      <SkeletonContainer className='w-full gap-0'>
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-[56%]' />
      </SkeletonContainer>
      <SkeletonContainer className='w-full gap-0'>
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-3/5' />
      </SkeletonContainer>
      <SkeletonContainer className='w-full gap-0'>
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-3/5' />
      </SkeletonContainer>
      <SkeletonContainer className='w-full gap-0'>
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-full' />
        <SkeletonRectangle className='my-1.5 w-1/2' />
      </SkeletonContainer>
    </div>
  )
}

export default React.memo(Loading)
