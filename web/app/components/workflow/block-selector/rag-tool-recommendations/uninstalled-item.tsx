'use client'
import type { Plugin } from '@/app/components/plugins/types'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useLocale } from '@/context/i18n'
import BlockIcon from '../../block-icon'
import { BlockEnum } from '../../types'

type UninstalledItemProps = {
  payload: Plugin
}

const UninstalledItem = ({
  payload,
}: UninstalledItemProps) => {
  const { t } = useTranslation()
  const locale = useLocale()

  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj?.[locale] || obj?.['en-US'] || obj?.en_US || ''
  const [isShowInstallModal, {
    setTrue: showInstallModal,
    setFalse: hideInstallModal,
  }] = useBoolean(false)

  return (
    <div className="flex h-8 items-center rounded-lg pr-2 pl-3 hover:bg-state-base-hover">
      <BlockIcon
        className="shrink-0"
        type={BlockEnum.Tool}
        toolIcon={payload.icon}
      />
      <div className="ml-2 flex w-0 grow items-center">
        <div className="flex w-0 grow items-center gap-x-2">
          <span className="truncate system-sm-regular text-text-primary">
            {getLocalizedText(payload.label)}
          </span>
          <span className="system-xs-regular text-text-quaternary">
            {payload.org}
          </span>
        </div>
        <div
          className="cursor-pointer pl-1.5 system-xs-medium text-components-button-secondary-accent-text"
          onClick={showInstallModal}
        >
          {t('installAction', { ns: 'plugin' })}
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
