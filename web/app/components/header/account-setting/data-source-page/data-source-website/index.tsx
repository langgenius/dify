'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import ConfigFirecrawlModal from './config-firecrawl-modal'
import cn from '@/utils/classnames'
import { fetchDataSources, removeDataSourceApiKeyBinding } from '@/service/datasets'

import type {
  DataSourceItem,
} from '@/models/common'
import { useAppContext } from '@/context/app-context'

import {
  DataSourceProvider,
} from '@/models/common'
import Toast from '@/app/components/base/toast'

type Props = {}

const DataSourceWebsite: FC<Props> = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [sources, setSources] = useState<DataSourceItem[]>([])
  const checkSetApiKey = useCallback(async () => {
    const res = await fetchDataSources() as any
    const list = res.sources
    setSources(list)
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

  const getIdByProvider = (provider: string): string | undefined => {
    const source = sources.find(item => item.provider === provider)
    return source?.id
  }

  const handleRemove = useCallback((provider: string) => {
    return async () => {
      const dataSourceId = getIdByProvider(provider)
      if (dataSourceId) {
        await removeDataSourceApiKeyBinding(dataSourceId)
        setSources(sources.filter(item => item.provider !== provider))
        Toast.notify({
          type: 'success',
          message: t('common.api.remove'),
        })
      }
    }
  }, [sources, t])

  return (
    <>
      <Panel
        type={DataSourceType.website}
        isConfigured={sources.length > 0}
        onConfigure={showConfig}
        readOnly={!isCurrentWorkspaceManager}
        configuredList={sources.map(item => ({
          id: item.id,
          logo: ({ className }: { className: string }) => (
            <div className={cn(className, 'flex items-center justify-center w-5 h-5 bg-white border border-gray-100 text-xs font-medium text-gray-500 rounded ml-3')}>🔥</div>
          ),
          name: 'Firecrawl',
          isActive: true,
        }))}
        onRemove={handleRemove(DataSourceProvider.fireCrawl)}
      />
      {isShowConfig && (
        <ConfigFirecrawlModal onSaved={handleAdded} onCancel={hideConfig} />
      )}
    </>

  )
}
export default React.memo(DataSourceWebsite)
