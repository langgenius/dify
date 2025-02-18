import React from 'react'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'
import Divider from '@/app/components/base/divider'

const CardSkelton = React.memo(() => {
  return (
    <SkeletonContainer className='gap-y-0 p-1 pb-2'>
      <SkeletonContainer className='gap-y-0.5 px-2 pt-1.5'>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='bg-text-quaternary w-[72px]' />
          <SkeletonPoint className='opacity-20' />
          <SkeletonRectangle className='bg-text-quaternary w-24' />
          <SkeletonPoint className='opacity-20' />
          <SkeletonRectangle className='bg-text-quaternary w-24' />
          <SkeletonRow className='grow justify-end gap-1'>
            <SkeletonRectangle className='bg-text-quaternary w-12' />
            <SkeletonRectangle className='bg-text-quaternary mx-1 w-2' />
          </SkeletonRow>
        </SkeletonRow>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='bg-text-quaternary w-full' />
        </SkeletonRow>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='bg-text-quaternary w-full' />
        </SkeletonRow>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='bg-text-quaternary w-2/3' />
        </SkeletonRow>
      </SkeletonContainer>
      <SkeletonContainer className='px-2 py-1.5'>
        <SkeletonRow>
          <SkeletonRectangle className='bg-text-quaternary w-14' />
          <SkeletonRectangle className='bg-text-quaternary w-[88px]' />
          <SkeletonRectangle className='bg-text-quaternary w-14' />
        </SkeletonRow>
      </SkeletonContainer>
    </SkeletonContainer>
  )
})

CardSkelton.displayName = 'CardSkelton'

const EmbeddingSkeleton = () => {
  return (
    <div className='relative z-10 flex grow flex-col overflow-y-hidden'>
      <div className='bg-dataset-chunk-list-mask-bg absolute left-0 top-0 z-20 h-full w-full' />
      {[...Array.from({ length: 5 })].map((_, index) => {
        return (
          <div key={index} className='w-full px-11'>
            <CardSkelton />
            {index !== 9 && <div className='w-full px-3'>
              <Divider type='horizontal' className='bg-divider-subtle my-1' />
            </div>}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(EmbeddingSkeleton)
