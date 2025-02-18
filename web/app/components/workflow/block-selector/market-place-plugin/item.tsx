'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import Action from './action'
import type { Plugin } from '@/app/components/plugins/types.ts'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import I18n from '@/context/i18n'
import cn from '@/utils/classnames'

import { formatNumber } from '@/utils/format'
import { useBoolean } from 'ahooks'

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
  const [open, setOpen] = React.useState(false)
  const { locale } = useContext(I18n)
  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj?.[locale] || obj?.['en-US'] || obj?.en_US || ''
  const [isShowInstallModal, {
    setTrue: showInstallModal,
    setFalse: hideInstallModal,
  }] = useBoolean(false)

  return (
    <div className='group/plugin hover:bg-state-base-hover flex rounded-lg py-1 pl-3 pr-1'>
      <div
        className='border-components-panel-border-subtle relative h-6 w-6 shrink-0 rounded-md border-[0.5px] bg-contain bg-center bg-no-repeat'
        style={{ backgroundImage: `url(${payload.icon})` }}
      />
      <div className='ml-2 flex w-0 grow'>
        <div className='w-0 grow'>
          <div className='text-text-primary system-sm-medium h-4 truncate leading-4 '>{getLocalizedText(payload.label)}</div>
          <div className='text-text-tertiary system-xs-regular h-5 truncate leading-5'>{getLocalizedText(payload.brief)}</div>
          <div className='text-text-tertiary system-xs-regular flex space-x-1'>
            <div>{payload.org}</div>
            <div>·</div>
            <div>{t('plugin.install', { num: formatNumber(payload.install_count || 0) })}</div>
          </div>
        </div>
        {/* Action */}
        <div className={cn(!open ? 'hidden' : 'flex', 'text-components-button-secondary-accent-text  system-xs-medium h-4 items-center space-x-1 group-hover/plugin:flex')}>
          <div className='cursor-pointer px-1.5' onClick={showInstallModal}>{t('plugin.installAction')}</div>
          <Action
            open={open}
            onOpenChange={setOpen}
            author={payload.org}
            name={payload.name}
            version={payload.latest_version}
          />
        </div>
        {isShowInstallModal && (
          <InstallFromMarketplace
            uniqueIdentifier={payload.latest_package_identifier}
            manifest={payload}
            onSuccess={hideInstallModal}
            onClose={hideInstallModal}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(Item)
