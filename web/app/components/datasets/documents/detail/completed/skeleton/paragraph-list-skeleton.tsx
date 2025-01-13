import React from 'react'
import { RiArrowRightSLine } from '@remixicon/react'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'

const CardSkelton = React.memo(() => {
  return (
    <SkeletonContainer className='p-1 pb-2 gap-y-0'>
      <SkeletonContainer className='px-2 pt-1.5 gap-y-0.5'>
        <SkeletonRow className='py-0.5'>
          <SkeletonRectangle className='w-[72px] bg-text-quaternary' />
          <SkeletonPoint className='opacity-20' />
          <SkeletonRectangle className='w-24 bg-text-quaternary' />
          <SkeletonPoint className='opacity-20' />
          <SkeletonRectangle className='w-24 bg-text-quaternary' />
          <SkeletonRow className='grow justify-end gap-1'>
            <SkeletonRectangle className='w-12 bg-text-quaternary' />
            <SkeletonRectangle className='w-2 bg-text-quaternary mx-1' />
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
      <SkeletonContainer className='p-1 pb-2'>
        <SkeletonRow>
          <SkeletonRow className='h-7 pl-1 pr-3 gap-x-0.5 rounded-lg bg-dataset-child-chunk-expand-btn-bg'>
            <RiArrowRightSLine className='w-4 h-4 text-text-secondary opacity-20' />
            <SkeletonRectangle className='w-32 bg-text-quaternary' />
          </SkeletonRow>
        </SkeletonRow>
      </SkeletonContainer>
    </SkeletonContainer>
  )
})

CardSkelton.displayName = 'CardSkelton'

const ParagraphListSkeleton = () => {
  return (
    <div className='relative flex flex-col h-full overflow-y-hidden z-10'>
      <div className='absolute top-0 left-0 w-full h-full bg-dataset-chunk-list-mask-bg z-20' />
      {[...Array(10)].map((_, index) => {
        return (
          <div key={index} className='flex items-start gap-x-2'>
            <Checkbox
              key={`${index}-checkbox`}
              className='shrink-0 mt-3.5'
              disabled
            />
            <div className='grow'>
              <CardSkelton />
              {index !== 9 && <div className='w-full px-3'>
                <Divider type='horizontal' className='bg-divider-subtle my-1' />
              </div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(ParagraphListSkeleton)
