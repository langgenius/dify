'use client'
import type { FC } from 'react'
import type { Plugin } from '@/app/components/plugins/types.ts'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useLocale } from '@/context/i18n'
import { cn } from '@/utils/classnames'

import { formatNumber } from '@/utils/format'
import Action from './action'

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
  const locale = useLocale()
  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj?.[locale] || obj?.['en-US'] || obj?.en_US || ''
  const [isShowInstallModal, {
    setTrue: showInstallModal,
    setFalse: hideInstallModal,
  }] = useBoolean(false)

  return (
    <div className="group/plugin flex rounded-lg py-1 pl-3 pr-1 hover:bg-state-base-hover">
      <div
        className="relative h-6 w-6 shrink-0 rounded-md border-[0.5px] border-components-panel-border-subtle bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${payload.icon})` }}
      />
      <div className="ml-2 flex w-0 grow">
        <div className="w-0 grow">
          <div className="system-sm-medium h-4 truncate leading-4 text-text-primary ">{getLocalizedText(payload.label)}</div>
          <div className="system-xs-regular h-5 truncate leading-5 text-text-tertiary">{getLocalizedText(payload.brief)}</div>
          <div className="system-xs-regular flex space-x-1 text-text-tertiary">
            <div>{payload.org}</div>
            <div>·</div>
            <div>{t('install', { ns: 'plugin', num: formatNumber(payload.install_count || 0) })}</div>
          </div>
        </div>
        {/* Action */}
        <div className={cn(!open ? 'hidden' : 'flex', 'system-xs-medium h-4 items-center space-x-1 text-components-button-secondary-accent-text group-hover/plugin:flex')}>
          <div
            className="cursor-pointer rounded-md px-1.5 py-0.5 hover:bg-state-base-hover"
            onClick={showInstallModal}
          >
            {t('installAction', { ns: 'plugin' })}
          </div>
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
