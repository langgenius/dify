'use client'
import type { FC } from 'react'
import type { InstallStatus, Plugin, VersionProps } from '../../../types'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import Card from '@/app/components/plugins/card'
import { MARKETPLACE_API_PREFIX } from '@/config'
import useGetIcon from '../../base/use-get-icon'
import Version from '../../base/version'

type Props = Readonly<{
  list: Plugin[]
  installStatus: InstallStatus[]
  versionInfo?: VersionProps[]
  onCancel: () => void
  isHideButton?: boolean
}>

const Installed: FC<Props> = ({ list, installStatus, versionInfo, onCancel, isHideButton }) => {
  const { t } = useTranslation()
  const { getIconUrl } = useGetIcon()
  return (
    <>
      <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
        <p className="system-md-regular text-text-secondary">
          {t(($) => $['installModal.installedSuccessfullyCountDesc'], {
            ns: 'plugin',
            num: list.length,
          })}
        </p>
        <div className="flex flex-wrap content-start items-start gap-1 space-y-1 self-stretch rounded-2xl bg-background-section-burn p-2">
          {list.map((plugin, index) => {
            const pluginVersionInfo = versionInfo?.[index]
            return (
              <Card
                key={plugin.plugin_id}
                className="w-full"
                payload={{
                  ...plugin,
                  icon: installStatus[index]!.isFromMarketPlace
                    ? `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`
                    : getIconUrl(plugin.icon),
                }}
                installed={installStatus[index]!.success}
                installFailed={!installStatus[index]!.success}
                titleLeft={
                  plugin.version ? (
                    pluginVersionInfo ? (
                      <Version {...pluginVersionInfo} />
                    ) : (
                      <Badge className="mx-1" size="s" state={BadgeState.Default}>
                        {plugin.version}
                      </Badge>
                    )
                  ) : null
                }
                compact
              />
            )
          })}
        </div>
      </div>
      {/* Action Buttons */}
      {!isHideButton && (
        <div className="flex items-center justify-end gap-2 self-stretch p-6 pt-5">
          <Button variant="primary" className="min-w-[72px]" onClick={onCancel}>
            {t(($) => $['operation.close'], { ns: 'common' })}
          </Button>
        </div>
      )}
    </>
  )
}

export default React.memo(Installed)
