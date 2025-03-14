import React, { type FC } from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type AdvancedActionsProps = {
  onCancel: () => void
  onConfirm: () => void
}

const AdvancedActions: FC<AdvancedActionsProps> = ({
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center gap-x-1'>
      <Button size='small' variant='secondary' onClick={onCancel}>
        {t('common.operation.cancel')}
      </Button>
      <Button size='small' variant='primary' onClick={onConfirm}>
        {t('common.operation.confirm')}
      </Button>
    </div>
  )
}

export default React.memo(AdvancedActions)
