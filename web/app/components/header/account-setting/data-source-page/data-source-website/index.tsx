'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import ConfigFirecrawlModal from './config-firecrawl-modal'
import { fetchWebsiteDataSource } from '@/service/common'
import type {
  DataSourceWebsiteItem,
} from '@/models/common'
import { useAppContext } from '@/context/app-context'

import {
  DataSourceCategory,
  WebsiteProvider,
} from '@/models/common'

type Props = {}

const isUseMock = false
const mockList: DataSourceWebsiteItem[] = [
  {
    id: '1',
    category: DataSourceCategory.website,
    provider: WebsiteProvider.fireCrawl,
    credentials: {
      auth_type: 'bearer',
      config: {
        base_url: 'https://xxx',
        api_key: '123456',
      },
    },
    created_at: 1627584000,
    updated_at: 1627584000,
  },
]

const DataSourceWebsite: FC<Props> = () => {
  const { isCurrentWorkspaceManager } = useAppContext()
  const [list, setList] = useState<DataSourceWebsiteItem[]>(isUseMock ? mockList : [])
  useEffect(() => {
    (async () => {
      const { data } = await fetchWebsiteDataSource()
      const list = data.settings.filter(item => item.provider === WebsiteProvider.fireCrawl)

      setList(list)
    })()
  }, [])

  const [isShowConfig, {
    setTrue: showConfig,
    setFalse: hideConfig,
  }] = useBoolean(false)

  const handleRemove = useCallback(() => {

  }, [])

  return (
    <>
      <Panel
        type={DataSourceType.website}
        isConfigured={list.length > 0}
        onConfigure={showConfig}
        readonly={!isCurrentWorkspaceManager}
        configuredList={list.map(item => ({
          id: item.id,
          logo: ({ className }: { className: string }) => (
            <div className={cn(className, 'flex items-center justify-center w-5 h-5 bg-white border border-gray-100 text-xs font-medium text-gray-500 rounded ml-3')}>🔥</div>
          ),
          name: 'FireCrawl',
          isActive: true,
        }))}
        onRemove={handleRemove}
      />
      {isShowConfig && (
        <ConfigFirecrawlModal onSaved={hideConfig} onCancel={hideConfig} />
      )}
    </>

  )
}
export default React.memo(DataSourceWebsite)
