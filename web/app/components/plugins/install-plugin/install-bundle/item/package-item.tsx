'use client'
import type { FC } from 'react'
import React from 'react'
import type { Plugin } from '../../../types'
import type { PackageDependency } from '../../../types'
import { pluginManifestToCardPluginProps } from '../../utils'
import LoadedItem from './loaded-item'
import LoadingError from '../../base/loading-error'
import type { VersionProps } from '@/app/components/plugins/types'

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
