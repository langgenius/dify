'use client'
import type { FC } from 'react'
import React from 'react'
import type { Plugin } from '../../../types'
import Loading from './loading'
import LoadedItem from './loaded-item'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  payload?: Plugin
}

const MarketPlaceItem: FC<Props> = ({
  checked,
  onCheckedChange,
  payload,
}) => {
  if (!payload) return <Loading />
  return (
    <LoadedItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      payload={payload}
    />
  )
}

export default React.memo(MarketPlaceItem)
