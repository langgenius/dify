import type { FC } from 'react'
import type { TimePickerFooterProps } from '../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../button'

const Footer: FC<TimePickerFooterProps> = ({
  handleSelectCurrentTime,
  handleConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between border-t-[0.5px] border-divider-regular p-2">
      {/* Now Button */}
      <Button
        variant="secondary-accent"
        size="small"
        className="mr-1 flex-1"
        onClick={handleSelectCurrentTime}
      >
        {t('operation.now', { ns: 'time' })}
      </Button>
      {/* Confirm Button */}
      <Button
        variant="primary"
        size="small"
        className="ml-1 flex-1"
        onClick={handleConfirm.bind(null)}
      >
        {t('operation.ok', { ns: 'time' })}
      </Button>
    </div>
  )
}

export default React.memo(Footer)
