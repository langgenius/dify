'use client'
import type { FC } from 'react'
import type { Plugin } from '@/app/components/plugins/types.ts'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useLocale } from '@/context/i18n'

import { formatNumber } from '@/utils/format'
import Action from './action'

type ActionType = 'install' | 'download'

type Props = Readonly<{
  payload: Plugin
  onAction: (type: ActionType) => void
}>

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
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()

  return (
    <div className="group/plugin flex rounded-lg py-1 pr-1 pl-3 select-none hover:bg-state-base-hover">
      <div
        className="relative h-6 w-6 shrink-0 rounded-md border-[0.5px] border-components-panel-border-subtle bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${payload.icon})` }}
      />
      <div className="ml-2 flex w-0 grow">
        <div className="w-0 grow">
          <div className="h-4 truncate system-sm-medium leading-4 text-text-primary">{getLocalizedText(payload.label)}</div>
          <div className="h-5 truncate system-xs-regular leading-5 text-text-tertiary">{getLocalizedText(payload.brief)}</div>
          <div className="flex space-x-1 system-xs-regular text-text-tertiary">
            <div>{payload.org}</div>
            <div>·</div>
            <div>{t($ => $.install, { ns: 'plugin', num: formatNumber(payload.install_count || 0) })}</div>
          </div>
        </div>
        {/* Action */}
        <div className={cn(!open ? 'hidden' : 'flex', 'h-4 items-center space-x-1 system-xs-medium text-components-button-secondary-accent-text group-hover/plugin:flex')}>
          {canInstallPlugin && (
            <button
              type="button"
              className="cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-0.5 hover:bg-state-base-hover"
              onClick={showInstallModal}
            >
              {t($ => $.installAction, { ns: 'plugin' })}
            </button>
          )}
          <Action
            open={open}
            onOpenChange={setOpen}
            author={payload.org}
            name={payload.name}
            version={payload.latest_version}
          />
        </div>
        {isShowInstallModal && canInstallPlugin && (
          <PluginInstallPermissionProvider
            canInstallPlugin={canInstallPlugin}
            currentDifyVersion={currentDifyVersion}
          >
            <InstallFromMarketplace
              uniqueIdentifier={payload.latest_package_identifier}
              manifest={payload}
              onSuccess={hideInstallModal}
              onClose={hideInstallModal}
            />
          </PluginInstallPermissionProvider>
        )}
      </div>
    </div>
  )
}
export default React.memo(Item)
