import { useTranslation } from 'react-i18next'
import { RiKey2Line } from '@remixicon/react'

const Empty = () => {
  const { t } = useTranslation()

  return (
    <div className='mb-2 rounded-xl bg-background-section p-6'>
      <div className='mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-sm'>
        <RiKey2Line className='h-5 w-5 text-text-accent' />
      </div>
      <div className='system-sm-medium mb-1 text-text-secondary'>{t('common.workspaceApiKey.title')}</div>
      <div className='system-xs-regular text-text-tertiary'>{t('common.workspaceApiKey.description')}</div>
    </div>
  )
}

export default Empty
