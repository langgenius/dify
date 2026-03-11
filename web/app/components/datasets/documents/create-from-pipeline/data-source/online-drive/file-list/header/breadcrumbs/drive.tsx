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
          breadcrumbs.length > 0 && 'system-sm-regular text-text-tertiary hover:bg-state-base-hover',
          breadcrumbs.length === 0 && 'system-sm-medium text-text-secondary',
        )}
        onClick={handleBackToRoot}
        disabled={breadcrumbs.length === 0}
      >
        {t('onlineDrive.breadcrumbs.allFiles', { ns: 'datasetPipeline' })}
      </button>
      {breadcrumbs.length > 0 && <span className="system-xs-regular text-divider-deep">/</span>}
    </>
  )
}

export default React.memo(Drive)
