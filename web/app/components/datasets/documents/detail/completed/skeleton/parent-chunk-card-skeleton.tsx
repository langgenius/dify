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
            <SkeletonRectangle className='bg-text-quaternary w-[72px]' />
            <SkeletonPoint className='opacity-20' />
            <SkeletonRectangle className='bg-text-quaternary w-24' />
            <SkeletonPoint className='opacity-20' />
            <SkeletonRectangle className='bg-text-quaternary w-24' />
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
      </SkeletonContainer>
      <div className='mt-0.5 flex items-center px-3'>
        <button type='button' className='text-components-button-secondary-accent-text-disabled system-xs-semibold-uppercase pt-0.5' disabled>
          {t('common.operation.viewMore')}
        </button>
      </div>
    </div>
  )
}

ParentChunkCardSkelton.displayName = 'ParentChunkCardSkelton'

export default React.memo(ParentChunkCardSkelton)
