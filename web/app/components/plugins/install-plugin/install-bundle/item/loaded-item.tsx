'use client'
import type { FC } from 'react'
import React from 'react'
import type { Plugin } from '../../../types'
import Card from '../../../card'
import Checkbox from '@/app/components/base/checkbox'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import useGetIcon from '../../base/use-get-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  payload: Plugin
  isFromMarketPlace?: boolean
}

const LoadedItem: FC<Props> = ({
  checked,
  onCheckedChange,
  payload,
  isFromMarketPlace,
}) => {
  const { getIconUrl } = useGetIcon()
  return (
    <div className='flex items-center space-x-2'>
      <Checkbox
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
        titleLeft={payload.version ? <Badge className='mx-1' size="s" state={BadgeState.Default}>{payload.version}</Badge> : null}
      />
    </div>
  )
}

export default React.memo(LoadedItem)
