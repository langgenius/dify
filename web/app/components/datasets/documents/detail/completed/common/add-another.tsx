import type { FC } from 'react'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type AddAnotherProps = {
  className?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

const AddAnother: FC<AddAnotherProps> = ({
  className,
  checked,
  onCheckedChange,
}) => {
  const { t } = useTranslation()

  return (
    <label className={cn('flex cursor-pointer items-center gap-x-1 pl-1', className)}>
      <Checkbox
        key="add-another-checkbox"
        className="shrink-0"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <span className="system-xs-medium text-text-tertiary">{t('segment.addAnother', { ns: 'datasetDocuments' })}</span>
    </label>
  )
}

export default React.memo(AddAnother)
