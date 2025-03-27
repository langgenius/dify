import Button from '@/app/components/base/button'
import { RiHistoryLine } from '@remixicon/react'
import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'

type EmptyProps = {
  onResetFilter: () => void
}

const Empty: FC<EmptyProps> = ({
  onResetFilter,
}) => {
  const { t } = useTranslation()

  return <div className='flex h-5/6 w-full flex-col justify-center gap-y-2'>
    <div className='flex justify-center'>
      <RiHistoryLine className='h-10 w-10 text-text-empty-state-icon' />
    </div>
    <div className='system-xs-regular flex justify-center text-text-tertiary'>
      {t('workflow.versionHistory.filter.empty')}
    </div>
    <div className='flex justify-center'>
      <Button size='small' onClick={onResetFilter}>
        {t('workflow.versionHistory.filter.reset')}
      </Button>
    </div>
  </div>
}

export default React.memo(Empty)
