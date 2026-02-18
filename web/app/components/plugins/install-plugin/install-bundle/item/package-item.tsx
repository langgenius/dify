'use client'
import type { FC } from 'react'
import type { PackageDependency, Plugin } from '../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import * as React from 'react'
import LoadingError from '../../base/loading-error'
import { pluginManifestToCardPluginProps } from '../../utils'
import LoadedItem from './loaded-item'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  payload: PackageDependency
  isFromMarketPlace?: boolean
  versionInfo: VersionProps
}

const PackageItem: FC<Props> = ({
  payload,
  checked,
  onCheckedChange,
  isFromMarketPlace,
  versionInfo,
}) => {
  if (!payload.value?.manifest)
    return <LoadingError />

  const plugin = pluginManifestToCardPluginProps(payload.value.manifest)
  return (
    <LoadedItem
      payload={{ ...plugin, from: payload.type }}
      checked={checked}
      onCheckedChange={onCheckedChange}
      isFromMarketPlace={isFromMarketPlace}
      versionInfo={versionInfo}
    />
  )
}

export default React.memo(PackageItem)
