import React, { type FC } from 'react'
import Button from '../../button'
import type { DatePickerFooterProps } from '../types'
import { RiTimeLine } from '@remixicon/react'
import cn from '@/utils/classnames'

const Footer: FC<DatePickerFooterProps> = ({
  needTimePicker,
  handleClickTimePicker,
  displayTime,
  handleSelectCurrentDate,
  handleConfirmDate,
}) => {
  return (
    <div className={cn(
      'flex justify-between items-center p-2 border-t-[0.5px] border-divider-regular',
      !needTimePicker && 'justify-end',
    )}>
      {/* Time Picker */}
      {needTimePicker && (
        <button
          type='button'
          className='flex items-center rounded-md px-1.5 py-1 gap-x-[1px] border-[0.5px] border-components-button-secondary-border system-xs-medium
                      bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] text-components-button-secondary-accent-text'
          onClick={handleClickTimePicker}
        >
          <RiTimeLine className='w-3.5 h-3.5' />
          <span>{displayTime}</span>
        </button>
      )}
      {/* Now and Confirm */}
      <div className='flex items-center gap-x-1'>
        {/* Now */}
        <button
          type='button'
          className='flex items-center justify-center px-1.5 py-1 text-components-button-secondary-accent-text system-xs-medium'
          onClick={handleSelectCurrentDate}
        >
          <span className='px-[3px]'>Now</span>
        </button>
        {/* Confirm Button */}
        <Button
          variant='primary'
          size='small'
          className='w-16 px-1.5 py-1'
          onClick={handleConfirmDate}
        >
          OK
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Footer)
