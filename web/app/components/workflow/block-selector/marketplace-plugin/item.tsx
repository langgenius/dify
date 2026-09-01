'use client'
import type { Plugin } from '@/app/components/plugins/types.ts'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginInstallPermissionProvider } from '@/app/components/plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useLocale } from '@/context/i18n'
import { formatNumber } from '@/utils/format'
import Action from './action'

type Props = Readonly<{
  payload: Plugin
}>

function Item({ payload }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const locale = useLocale()
  const getLocalizedText = (obj: Record<string, string> | undefined) =>
    obj?.[locale] || obj?.['en-US'] || obj?.en_US || ''
  const [isShowInstallModal, { setTrue: showInstallModal, setFalse: hideInstallModal }] =
    useBoolean(false)
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()

  return (
    <div className="group/plugin flex rounded-lg py-1 pr-1 pl-3 select-none hover:bg-state-base-hover">
      <div
        className="relative h-6 w-6 shrink-0 rounded-md border-[0.5px] border-components-panel-border-subtle bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${payload.icon})` }}
      />
      <div className="ml-2 flex w-0 grow">
        <div className="w-0 grow">
          <div className="h-4 truncate system-sm-medium leading-4 text-text-primary">
            {getLocalizedText(payload.label)}
          </div>
          <div className="h-5 truncate system-xs-regular leading-5 text-text-tertiary">
            {getLocalizedText(payload.brief)}
          </div>
          <div className="flex space-x-1 system-xs-regular text-text-tertiary">
            <div>{payload.org}</div>
            <div>·</div>
            <div>
              {t(($) => $.install, { ns: 'plugin', num: formatNumber(payload.install_count || 0) })}
            </div>
          </div>
        </div>
        <div
          className={cn(
            'flex h-4 items-center space-x-1 system-xs-medium text-components-button-secondary-accent-text opacity-0',
            open
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none group-focus-within/plugin:pointer-events-auto group-focus-within/plugin:opacity-100 group-hover/plugin:pointer-events-auto group-hover/plugin:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
          )}
        >
          {canInstallPlugin && (
            <Button
              variant="ghost"
              size="small"
              className="h-6 px-1.5 text-components-button-secondary-accent-text focus-visible:ring-inset"
              onClick={showInstallModal}
            >
              {t(($) => $.installAction, { ns: 'plugin' })}
            </Button>
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

export default memo(Item)
