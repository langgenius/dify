'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useAppDetail } from '@/service/use-apps'
import type { App } from '@/types/app'
import cn from '@/utils/classnames'

type Props = {
  appDetail: App
}

const AppInputsPanel = ({
  appDetail,
}: Props) => {
  const { t } = useTranslation()
  const { data: currentApp, isFetching: isLoading } = useAppDetail(appDetail.id)

  const inputs = []

  return (
    <div className={cn('px-4 pb-4 rounded-b-2xl border-t border-divider-subtle')}>
      {isLoading && <div className='pt-3'><Loading type='app' /></div>}
      {!isLoading && (
        <div className='mt-3 mb-2 h-6 flex items-center system-sm-semibold text-text-secondary'>{t('app.appSelector.params')}</div>
      )}
      {!isLoading && !inputs.length && (
        <div className='h-16 flex flex-col justify-center items-center'>
          <div className='text-text-tertiary system-sm-regular'>{t('app.appSelector.noParams')}</div>
        </div>
      )}
    </div>
  )
}

export default AppInputsPanel
