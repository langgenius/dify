'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import Action from './action'
import type { Plugin } from '@/app/components/plugins/types.ts'
import I18n from '@/context/i18n'

import { formatNumber } from '@/utils/format'

enum ActionType {
  install = 'install',
  download = 'download',
  // viewDetail = 'viewDetail', // wait for marketplace api
}
type Props = {
  payload: Plugin
  onAction: (type: ActionType) => void
}

const Item: FC<Props> = ({
  payload,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  return (
    <div className='flex rounded-lg py-2 pr-1 pl-3 hover:bg-state-base-hover'>
      <div
        className='shrink-0 relative w-6 h-6 border-[0.5px] border-components-panel-border-subtle rounded-md bg-center bg-no-repeat bg-contain'
        style={{ backgroundImage: `url(${payload.icon})` }}
      />
      <div className='ml-2 w-0 grow flex'>
        <div className='w-0 grow'>
          <div className='h-4 leading-4 text-text-primary system-sm-medium truncate '>{payload.label[locale]}</div>
          <div className='h-5 leading-5 text-text-tertiary system-xs-regular truncate'>{payload.brief[locale]}</div>
          <div className='flex text-text-tertiary system-xs-regular space-x-1'>
            <div>{payload.org}</div>
            <div>·</div>
            <div>{t('plugin.install', { num: formatNumber(payload.install_count || 0) })}</div>
          </div>
        </div>
        {/* Action */}
        <div className='flex items-center space-x-1 h-4 text-components-button-secondary-accent-text system-xs-medium'>
          <div className='px-1.5'>{t('plugin.installAction')}</div>
          <Action />
        </div>
      </div>

    </div>
  )
}
export default React.memo(Item)
