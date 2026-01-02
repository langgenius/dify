'use client'
import type { FC } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import Indicator from '../../../indicator'
import Operate from '../data-source-notion/operate'
import s from './style.module.css'
import { DataSourceType } from './types'

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
  const onChangeAuthorizedPage = notionActions?.onChangeAuthorizedPage || noop

  return (
    <div className={cn(s['workspace-item'], 'mb-1 flex items-center rounded-lg bg-components-panel-on-panel-item-bg py-1 pr-1')} key={payload.id}>
      <payload.logo className="ml-3 mr-1.5" />
      <div className="system-sm-medium grow truncate py-[7px] text-text-secondary" title={payload.name}>{payload.name}</div>
      {
        payload.isActive
          ? <Indicator className="mr-[6px] shrink-0" color="green" />
          : <Indicator className="mr-[6px] shrink-0" color="yellow" />
      }
      <div className={`system-xs-semibold-uppercase mr-3 shrink-0 ${payload.isActive ? 'text-util-colors-green-green-600' : 'text-util-colors-warning-warning-600'}`}>
        {
          payload.isActive
            ? t(isNotion ? 'dataSource.notion.connected' : 'dataSource.website.active', { ns: 'common' })
            : t(isNotion ? 'dataSource.notion.disconnected' : 'dataSource.website.inactive', { ns: 'common' })
        }
      </div>
      <div className="mr-2 h-3 w-[1px] bg-divider-regular" />
      {isNotion && (
        <Operate
          payload={{
            id: payload.id,
            total: payload.notionConfig?.total || 0,
          }}
          onAuthAgain={onChangeAuthorizedPage}
        />
      )}

      {
        isWebsite && !readOnly && (
          <div className="cursor-pointer rounded-md p-2 text-text-tertiary hover:bg-state-base-hover" onClick={onRemove}>
            <RiDeleteBinLine className="h-4 w-4" />
          </div>
        )
      }

    </div>
  )
}
export default React.memo(ConfigItem)
