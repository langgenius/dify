import type { FC } from 'react'
import React from 'react'
import Button from '../../button'
import type { YearAndMonthPickerFooterProps } from '../types'

const Footer: FC<YearAndMonthPickerFooterProps> = ({
  handleYearMonthCancel,
  handleYearMonthConfirm,
}) => {
  return (
    <div className='grid grid-cols-2 gap-x-1 p-2'>
      <Button size='small' onClick={handleYearMonthCancel}>
        Cancel
      </Button>
      <Button variant='primary' size='small' onClick={handleYearMonthConfirm}>
        OK
      </Button>
    </div>
  )
}

export default React.memo(Footer)
