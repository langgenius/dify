'use client'
import type { FC } from 'react'
import type { Plugin } from '../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import * as React from 'react'
import Loading from '../../base/loading'
import LoadedItem from './loaded-item'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  payload?: Plugin
  version: string
  versionInfo: VersionProps
}

const MarketPlaceItem: FC<Props> = ({
  checked,
  onCheckedChange,
  payload,
  version,
  versionInfo,
}) => {
  if (!payload)
    return <Loading />
  return (
    <LoadedItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      payload={{ ...payload, version }}
      isFromMarketPlace
      versionInfo={versionInfo}
    />
  )
}

export default React.memo(MarketPlaceItem)
