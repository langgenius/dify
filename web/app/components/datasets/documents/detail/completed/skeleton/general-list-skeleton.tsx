import React from 'react'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'

export const CardSkelton = React.memo(() => {
  return (
    <SkeletonContainer className='gap-y-0 p-1 pb-2'>
      <SkeletonContainer className='gap-y-0.5 px-2 pt-1.5'>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='w-[72px] bg-text-quaternary' />
          <SkeletonPoint className='opacity-20' />
          <SkeletonRectangle className='w-24 bg-text-quaternary' />
          <SkeletonPoint className='opacity-20' />
          <SkeletonRectangle className='w-24 bg-text-quaternary' />
          <SkeletonRow className='grow justify-end gap-1'>
            <SkeletonRectangle className='w-12 bg-text-quaternary' />
            <SkeletonRectangle className='mx-1 w-2 bg-text-quaternary' />
          </SkeletonRow>
        </SkeletonRow>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='w-full bg-text-quaternary' />
        </SkeletonRow>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='w-full bg-text-quaternary' />
        </SkeletonRow>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='w-2/3 bg-text-quaternary' />
        </SkeletonRow>
      </SkeletonContainer>
      <SkeletonContainer className='px-2 py-1.5'>
        <SkeletonRow>
          <SkeletonRectangle className='w-14 bg-text-quaternary' />
          <SkeletonRectangle className='w-[88px] bg-text-quaternary' />
          <SkeletonRectangle className='w-14 bg-text-quaternary' />
        </SkeletonRow>
      </SkeletonContainer>
    </SkeletonContainer>
  )
})

CardSkelton.displayName = 'CardSkelton'

const GeneralListSkeleton = () => {
  return (
    <div className='relative z-10 flex grow flex-col overflow-y-hidden'>
      <div className='absolute left-0 top-0 z-20 h-full w-full bg-dataset-chunk-list-mask-bg' />
      {Array.from({ length: 10 }).map((_, index) => {
        return (
          <div key={index} className='flex items-start gap-x-2'>
            <Checkbox
              key={`${index}-checkbox`}
              className='mt-3.5 shrink-0'
              disabled
            />
            <div className='grow'>
              <CardSkelton />
              {index !== 9 && <div className='w-full px-3'>
                <Divider type='horizontal' className='my-1 bg-divider-subtle' />
              </div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(GeneralListSkeleton)
