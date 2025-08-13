import React from 'react'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

type DriveProps = {
  prefix: string[]
  handleBackToRoot: () => void
}

const Drive = ({
  prefix,
  handleBackToRoot,
}: DriveProps) => {
  const { t } = useTranslation()

  return (
    <>
      <button
        type='button'
        className={cn(
          'max-w-full shrink truncate rounded-md px-[5px] py-1',
          prefix.length > 0 && 'system-sm-regular text-text-tertiary hover:bg-state-base-hover',
          prefix.length === 0 && 'system-sm-medium text-text-secondary',
        )}
        onClick={handleBackToRoot}
        disabled={prefix.length === 0}
      >
        {t('datasetPipeline.onlineDrive.breadcrumbs.allFiles')}
      </button>
      {prefix.length > 0 && <span className='system-xs-regular text-divider-deep'>/</span>}
    </>
  )
}

export default React.memo(Drive)
