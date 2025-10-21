import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'

const ParentChunkCardSkelton = () => {
  const { t } = useTranslation()
  return (
    <div className='flex flex-col pb-2'>
      <SkeletonContainer className='gap-y-0 p-1 pb-0'>
        <SkeletonContainer className='gap-y-0.5 px-2 pt-1.5'>
          <SkeletonRow className='py-0.5'>
            <SkeletonRectangle className='w-[72px] bg-text-quaternary' />
            <SkeletonPoint className='opacity-20' />
            <SkeletonRectangle className='w-24 bg-text-quaternary' />
            <SkeletonPoint className='opacity-20' />
            <SkeletonRectangle className='w-24 bg-text-quaternary' />
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
      </SkeletonContainer>
      <div className='mt-0.5 flex items-center px-3'>
        <button type='button' className='system-xs-semibold-uppercase pt-0.5 text-components-button-secondary-accent-text-disabled' disabled>
          {t('common.operation.viewMore')}
        </button>
      </div>
    </div>
  )
}

ParentChunkCardSkelton.displayName = 'ParentChunkCardSkelton'

export default React.memo(ParentChunkCardSkelton)
