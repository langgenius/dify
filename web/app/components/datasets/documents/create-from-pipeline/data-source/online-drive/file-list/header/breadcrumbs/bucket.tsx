import React from 'react'
import { BucketsGray } from '@/app/components/base/icons/src/public/knowledge/online-drive'
import Tooltip from '@/app/components/base/tooltip'
import { useTranslation } from 'react-i18next'

type BucketProps = {
  handleBackToBucketList: () => void
}

const Bucket = ({
  handleBackToBucketList,
}: BucketProps) => {
  const { t } = useTranslation()

  return (
    <>
      <Tooltip
        popupContent={t('datasetPipeline.onlineDrive.breadcrumbs.allBuckets')}
      >
        <button
          type='button'
          className='flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover'
          onClick={handleBackToBucketList}
        >
          <BucketsGray />
        </button>
      </Tooltip>
      <span className='system-xs-regular text-divider-deep'>/</span>
    </>
  )
}

export default React.memo(Bucket)
