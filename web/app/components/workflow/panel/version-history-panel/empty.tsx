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

  return <div className='h-5/6 w-full flex flex-col justify-center gap-y-2'>
    <div className='flex justify-center'>
      <RiHistoryLine className='w-10 h-10 text-text-empty-state-icon' />
    </div>
    <div className='flex justify-center text-text-tertiary system-xs-regular'>
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
