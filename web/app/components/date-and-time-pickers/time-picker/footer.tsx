import React, { type FC } from 'react'
import type { TimePickerFooterProps } from '../types'
import Button from '../../base/button'

const Footer: FC<TimePickerFooterProps> = ({
  handleSelectCurrentTime,
  handleConfirm,
}) => {
  return (
    <div className='flex justify-end items-center p-2 border-t-[0.5px] border-divider-regular'>
      {/* Now and Confirm */}
      <div className='flex items-center gap-x-1'>
        {/* Now */}
        <button
          type='button'
          className='flex items-center justify-center px-1.5 py-1 text-components-button-secondary-accent-text system-xs-medium'
          onClick={handleSelectCurrentTime}
        >
          <span className='px-[3px]'>Now</span>
        </button>
        {/* Confirm Button */}
        <Button
          variant='primary'
          size='small'
          className='w-16 px-1.5 py-1'
          onClick={handleConfirm.bind(null)}
        >
          OK
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Footer)
