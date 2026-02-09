import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import { cn } from '@/utils/classnames'

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
    <div className={cn('flex items-center gap-x-1 pl-1', className)}>
      <Checkbox
        key="add-another-checkbox"
        className="shrink-0"
        checked={isChecked}
        onCheck={onCheck}
      />
      <span className="text-text-tertiary system-xs-medium">{t('segment.addAnother', { ns: 'datasetDocuments' })}</span>
    </div>
  )
}

export default React.memo(AddAnother)
