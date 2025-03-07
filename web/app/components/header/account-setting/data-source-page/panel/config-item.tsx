'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import Indicator from '../../../indicator'
import Operate from '../data-source-notion/operate'
import { DataSourceType } from './types'
import s from './style.module.css'
import cn from '@/utils/classnames'

export type ConfigItemType = {
  id: string
  logo: any
  name: string
  isActive: boolean
  notionConfig?: {
    total: number
  }
}

type Props = {
  type: DataSourceType
  payload: ConfigItemType
  onRemove: () => void
  notionActions?: {
    onChangeAuthorizedPage: () => void
  }
  readOnly: boolean
}

const ConfigItem: FC<Props> = ({
  type,
  payload,
  onRemove,
  notionActions,
  readOnly,
}) => {
  const { t } = useTranslation()
  const isNotion = type === DataSourceType.notion
  const isWebsite = type === DataSourceType.website
  const onChangeAuthorizedPage = notionActions?.onChangeAuthorizedPage || function () { }

  return (
    <div className={cn(s['workspace-item'], 'flex items-center mb-1 py-1 pr-1 bg-components-panel-on-panel-item-bg rounded-lg')} key={payload.id}>
      <payload.logo className='ml-3 mr-1.5' />
      <div className='grow py-[7px] system-sm-medium text-text-secondary truncate' title={payload.name}>{payload.name}</div>
      {
        payload.isActive
          ? <Indicator className='shrink-0 mr-[6px]' color='green' />
          : <Indicator className='shrink-0 mr-[6px]' color='yellow' />
      }
      <div className={`shrink-0 mr-3 system-xs-semibold-uppercase ${payload.isActive ? 'text-util-colors-green-green-600' : 'text-util-colors-warning-warning-600'}`}>
        {
          payload.isActive
            ? t(isNotion ? 'common.dataSource.notion.connected' : 'common.dataSource.website.active')
            : t(isNotion ? 'common.dataSource.notion.disconnected' : 'common.dataSource.website.inactive')
        }
      </div>
      <div className='mr-2 w-[1px] h-3 bg-divider-regular' />
      {isNotion && (
        <Operate payload={{
          id: payload.id,
          total: payload.notionConfig?.total || 0,
        }} onAuthAgain={onChangeAuthorizedPage}
        />
      )}

      {
        isWebsite && !readOnly && (
          <div className='p-2 text-text-tertiary cursor-pointer rounded-md hover:bg-state-base-hover' onClick={onRemove} >
            <RiDeleteBinLine className='w-4 h-4' />
          </div>
        )
      }

    </div>
  )
}
export default React.memo(ConfigItem)
