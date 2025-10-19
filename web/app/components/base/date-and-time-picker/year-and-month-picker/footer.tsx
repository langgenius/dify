import type { FC } from 'react'
import React from 'react'
import Button from '../../button'
import type { YearAndMonthPickerFooterProps } from '../types'
import { useTranslation } from 'react-i18next'

const Footer: FC<YearAndMonthPickerFooterProps> = ({
  handleYearMonthCancel,
  handleYearMonthConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <div className='grid grid-cols-2 gap-x-1 p-2'>
      <Button size='small' onClick={handleYearMonthCancel}>
        {t('time.operation.cancel')}
      </Button>
      <Button variant='primary' size='small' onClick={handleYearMonthConfirm}>
        {t('time.operation.ok')}
      </Button>
    </div>
  )
}

export default React.memo(Footer)
