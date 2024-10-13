import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'

const ActionCard = () => {
  return (
    <div className='px-4 py-3 bg-components-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle shadow-xs cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover'>
      <div className='pb-0.5 text-text-secondary system-md-semibold'>Notion Page Search</div>
      <div className='text-text-tertiary system-xs-regular line-clamp-2'>A tool for performing a Google SERP search and extracting snippets and webpages.Input should be a search query.</div>
    </div>
  )
}

const ActionList = () => {
  const { t } = useTranslation()
  return (
    <div className='px-4 pt-2 pb-4'>
      <div className='mb-1 py-1'>
        <div className='mb-1 h-6 flex items-center justify-between text-text-secondary system-sm-semibold-uppercase'>
          {t('plugin.detailPanel.actionNum', { num: 3 })}
          <Button variant='secondary' size='small'>
            <Indicator className='mr-2' color={'green'} />
            {t('tools.auth.authorized')}
          </Button>
        </div>
        <Button variant='primary' className='w-full'>{t('tools.auth.unauthorized')}</Button>
      </div>
      <div className='flex flex-col gap-2'>
        <ActionCard />
        <ActionCard />
        <ActionCard />
      </div>
    </div>
  )
}

export default ActionList
