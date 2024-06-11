'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import ConfigFirecrawlModal from './config-firecrawl-modal'
import { fetchFirecrawlApiKey, removeFirecrawlApiKey } from '@/service/datasets'

import type {
  DataSourceWebsiteItem,
} from '@/models/common'
import { useAppContext } from '@/context/app-context'

import {
  WebsiteProvider,
} from '@/models/common'
import Toast from '@/app/components/base/toast'

type Props = {}

const DataSourceWebsite: FC<Props> = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [list, setList] = useState<DataSourceWebsiteItem[]>([])
  const checkSetApiKey = useCallback(async () => {
    const res = await fetchFirecrawlApiKey() as any
    const list = res.settings.filter((item: DataSourceWebsiteItem) => item.provider === WebsiteProvider.fireCrawl && !item.disabled)
    setList(list)
  }, [])

  useEffect(() => {
    checkSetApiKey()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [isShowConfig, {
    setTrue: showConfig,
    setFalse: hideConfig,
  }] = useBoolean(false)

  const handleAdded = useCallback(() => {
    checkSetApiKey()
    hideConfig()
  }, [checkSetApiKey, hideConfig])

  const handleRemove = useCallback(async () => {
    await removeFirecrawlApiKey(list[0].id)
    setList([])
    Toast.notify({
      type: 'success',
      message: t('common.api.remove'),
    })
  }, [list, t])

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
        <ConfigFirecrawlModal onSaved={handleAdded} onCancel={hideConfig} />
      )}
    </>

  )
}
export default React.memo(DataSourceWebsite)
