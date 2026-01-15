import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const OfficeFilePlaceholder: FC = () => {
  const { t } = useTranslation('workflow')

  return (
    <div className="flex h-full w-full items-center justify-center text-text-tertiary">
      <span className="system-sm-regular">
        {t('skillEditor.officePlaceholder')}
      </span>
    </div>
  )
}

export default React.memo(OfficeFilePlaceholder)
