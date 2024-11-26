'use client'
import type { FC } from 'react'
import React from 'react'
import type { Plugin } from '../../../types'
import type { PackageDependency } from '../../../types'
import { pluginManifestToCardPluginProps } from '../../utils'
import LoadedItem from './loaded-item'
import LoadingError from '../../base/loading-error'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  payload: PackageDependency
  isFromMarketPlace?: boolean
}

const PackageItem: FC<Props> = ({
  payload,
  checked,
  onCheckedChange,
  isFromMarketPlace,
}) => {
  if (!payload.value?.manifest)
    return <LoadingError />

  const plugin = pluginManifestToCardPluginProps(payload.value.manifest)
  return (
    <LoadedItem
      payload={plugin}
      checked={checked}
      onCheckedChange={onCheckedChange}
      isFromMarketPlace={isFromMarketPlace}
    />
  )
}

export default React.memo(PackageItem)
