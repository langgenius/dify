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
    <div className='flex items-center justify-end border-t-[0.5px] border-divider-regular p-2'>
      <div className='flex items-center gap-x-1'>
        {/* Now */}
        <button
          type='button'
          className='system-xs-medium flex items-center justify-center px-1.5 py-1 text-components-button-secondary-accent-text'
          onClick={handleSelectCurrentTime}
        >
          <span className='px-[3px]'>{t('time.operation.now')}</span>
        </button>
        {/* Confirm Button */}
        <Button
          variant='primary'
          size='small'
          className='w-16 px-1.5 py-1'
          onClick={handleConfirm.bind(null)}
        >
          {t('time.operation.ok')}
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Footer)
