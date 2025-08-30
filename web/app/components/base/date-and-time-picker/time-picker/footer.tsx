import React, { type FC } from 'react'
import type { TimePickerFooterProps } from '../types'
import Button from '../../button'
import { useTranslation } from 'react-i18next'

const Footer: FC<TimePickerFooterProps> = ({
  handleSelectCurrentTime,
  handleConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-between border-t-[0.5px] border-divider-regular p-2'>
      {/* Now Button */}
      <Button
        variant='secondary-accent'
        size='small'
        className='mr-1 flex-1'
        onClick={handleSelectCurrentTime}
      >
        {t('time.operation.now')}
      </Button>
      {/* Confirm Button */}
      <Button
        variant='primary'
        size='small'
        className='ml-1 flex-1'
        onClick={handleConfirm.bind(null)}
      >
        {t('time.operation.ok')}
      </Button>
    </div>
  )
}

export default React.memo(Footer)
