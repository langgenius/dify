import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  SkeletonContanier,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'

const ParentChunkCardSkelton = () => {
  const { t } = useTranslation()
  return (
    <div className='flex flex-col pb-2'>
      <SkeletonContanier className='p-1 pb-0 gap-y-0'>
        <SkeletonContanier className='px-2 pt-1.5 gap-y-0.5'>
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
        </SkeletonContanier>
      </SkeletonContanier>
      <div className='flex items-center px-3 mt-0.5'>
        <button className='pt-0.5 text-components-button-secondary-accent-text-disabled system-xs-semibold-uppercase' disabled>
          {t('common.operation.viewMore')}
        </button>
      </div>
    </div>
  )
}

ParentChunkCardSkelton.displayName = 'ParentChunkCardSkelton'

export default React.memo(ParentChunkCardSkelton)
