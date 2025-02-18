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
      <SkeletonContainer className='p-1 pb-2'>
        <SkeletonRow>
          <SkeletonRow className='bg-dataset-child-chunk-expand-btn-bg h-7 gap-x-0.5 rounded-lg pl-1 pr-3'>
            <RiArrowRightSLine className='text-text-secondary h-4 w-4 opacity-20' />
            <SkeletonRectangle className='bg-text-quaternary w-32' />
          </SkeletonRow>
        </SkeletonRow>
      </SkeletonContainer>
    </SkeletonContainer>
  )
})

CardSkelton.displayName = 'CardSkelton'

const ParagraphListSkeleton = () => {
  return (
    <div className='relative z-10 flex h-full flex-col overflow-y-hidden'>
      <div className='bg-dataset-chunk-list-mask-bg absolute left-0 top-0 z-20 h-full w-full' />
      {[...Array.from({ length: 10 })].map((_, index) => {
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
