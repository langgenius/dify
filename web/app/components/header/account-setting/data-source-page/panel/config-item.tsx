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
    <div className={cn(s['workspace-item'], 'bg-components-panel-on-panel-item-bg mb-1 flex items-center rounded-lg py-1 pr-1')} key={payload.id}>
      <payload.logo className='ml-3 mr-1.5' />
      <div className='system-sm-medium text-text-secondary grow truncate py-[7px]' title={payload.name}>{payload.name}</div>
      {
        payload.isActive
          ? <Indicator className='mr-[6px] shrink-0' color='green' />
          : <Indicator className='mr-[6px] shrink-0' color='yellow' />
      }
      <div className={`mr-3 shrink-0 text-xs font-medium uppercase ${payload.isActive ? 'text-util-colors-green-green-600' : 'text-util-colors-warning-warning-600'}`}>
        {
          payload.isActive
            ? t(isNotion ? 'common.dataSource.notion.connected' : 'common.dataSource.website.active')
            : t(isNotion ? 'common.dataSource.notion.disconnected' : 'common.dataSource.website.inactive')
        }
      </div>
      <div className='bg-divider-regular mr-2 h-3 w-[1px]' />
      {isNotion && (
        <Operate payload={{
          id: payload.id,
          total: payload.notionConfig?.total || 0,
        }} onAuthAgain={onChangeAuthorizedPage}
        />
      )}

      {
        isWebsite && !readOnly && (
          <div className='text-text-tertiary cursor-pointer rounded-md p-2 hover:bg-black/5' onClick={onRemove} >
            <RiDeleteBinLine className='h-4 w-4' />
          </div>
        )
      }

    </div>
  )
}
export default React.memo(ConfigItem)
