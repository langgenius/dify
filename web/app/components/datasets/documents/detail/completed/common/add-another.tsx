import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from '@/utils/classnames'
import Checkbox from '@/app/components/base/checkbox'

type AddAnotherProps = {
  className?: string
  isChecked: boolean
  onCheck: () => void
}

const AddAnother: FC<AddAnotherProps> = ({
  className,
  isChecked,
  onCheck,
}) => {
  const { t } = useTranslation()

  return (
    <div className={classNames('flex items-center gap-x-1 pl-1', className)}>
      <Checkbox
        key='add-another-checkbox'
        className='shrink-0'
        checked={isChecked}
        onCheck={onCheck}
      />
      <span className='system-xs-medium text-text-tertiary'>{t('datasetDocuments.segment.addAnother')}</span>
    </div>
  )
}

export default React.memo(AddAnother)
