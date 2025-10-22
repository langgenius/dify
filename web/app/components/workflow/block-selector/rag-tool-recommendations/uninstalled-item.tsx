'use client'
import React from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import type { Plugin } from '@/app/components/plugins/types'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import I18n from '@/context/i18n'
import { useBoolean } from 'ahooks'
import { BlockEnum } from '../../types'
import BlockIcon from '../../block-icon'

type UninstalledItemProps = {
  payload: Plugin
}

const UninstalledItem = ({
  payload,
}: UninstalledItemProps) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj?.[locale] || obj?.['en-US'] || obj?.en_US || ''
  const [isShowInstallModal, {
    setTrue: showInstallModal,
    setFalse: hideInstallModal,
  }] = useBoolean(false)

  return (
    <div className='flex h-8 items-center rounded-lg pl-3 pr-2 hover:bg-state-base-hover'>
      <BlockIcon
        className='shrink-0'
        type={BlockEnum.Tool}
        toolIcon={payload.icon}
      />
      <div className='ml-2 flex w-0 grow items-center'>
        <div className='flex w-0 grow items-center gap-x-2'>
          <span className='system-sm-regular truncate text-text-primary'>
            {getLocalizedText(payload.label)}
          </span>
          <span className='system-xs-regular text-text-quaternary'>
            {payload.org}
          </span>
        </div>
        <div
          className='system-xs-medium cursor-pointer pl-1.5 text-components-button-secondary-accent-text'
          onClick={showInstallModal}
        >
          {t('plugin.installAction')}
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
export default React.memo(UninstalledItem)
