'use client'
import type { FC } from 'react'
import React from 'react'
import type { Plugin } from '../../../types'
import Card from '../../../card'
import Checkbox from '@/app/components/base/checkbox'
import useGetIcon from '../../base/use-get-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'
import Version from '../../base/version'
import type { VersionProps } from '../../../types'
import usePluginInstallLimit from '../../hooks/use-install-plugin-limit'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  payload: Plugin
  isFromMarketPlace?: boolean
  versionInfo: VersionProps
}

const LoadedItem: FC<Props> = ({
  checked,
  onCheckedChange,
  payload,
  isFromMarketPlace,
  versionInfo: particleVersionInfo,
}) => {
  const { getIconUrl } = useGetIcon()
  const versionInfo = {
    ...particleVersionInfo,
    toInstallVersion: payload.version,
  }
  const { canInstall } = usePluginInstallLimit(payload)
  return (
    <div className='flex items-center space-x-2'>
      <Checkbox
        disabled={!canInstall}
        className='shrink-0'
        checked={checked}
        onCheck={() => onCheckedChange(payload)}
      />
      <Card
        className='grow'
        payload={{
          ...payload,
          icon: isFromMarketPlace ? `${MARKETPLACE_API_PREFIX}/plugins/${payload.org}/${payload.name}/icon` : getIconUrl(payload.icon),
        }}
        titleLeft={payload.version ? <Version {...versionInfo} /> : null}
        limitedInstall={!canInstall}
      />
    </div>
  )
}

export default React.memo(LoadedItem)
