import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type DriveProps = {
  breadcrumbs: string[]
  handleBackToRoot: () => void
}

const Drive = ({
  breadcrumbs,
  handleBackToRoot,
}: DriveProps) => {
  const { t } = useTranslation()

  return (
    <>
      <button
        type="button"
        className={cn(
          'max-w-full shrink truncate rounded-md px-[5px] py-1',
          breadcrumbs.length > 0 && 'text-text-tertiary system-sm-regular hover:bg-state-base-hover',
          breadcrumbs.length === 0 && 'text-text-secondary system-sm-medium',
        )}
        onClick={handleBackToRoot}
        disabled={breadcrumbs.length === 0}
      >
        {t('onlineDrive.breadcrumbs.allFiles', { ns: 'datasetPipeline' })}
      </button>
      {breadcrumbs.length > 0 && <span className="text-divider-deep system-xs-regular">/</span>}
    </>
  )
}

export default React.memo(Drive)
