import type { FC } from 'react'
import type { YearAndMonthPickerFooterProps } from '../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../button'

const Footer: FC<YearAndMonthPickerFooterProps> = ({
  handleYearMonthCancel,
  handleYearMonthConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-2 gap-x-1 p-2">
      <Button size="small" onClick={handleYearMonthCancel}>
        {t('operation.cancel', { ns: 'time' })}
      </Button>
      <Button variant="primary" size="small" onClick={handleYearMonthConfirm}>
        {t('operation.ok', { ns: 'time' })}
      </Button>
    </div>
  )
}

export default React.memo(Footer)
