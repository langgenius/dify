'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Panel from '../panel'
import { DataSourceType } from '../panel/types'
import ConfigFirecrawlModal from './config-firecrawl-modal'
import ConfigWatercrawlModal from './config-watercrawl-modal'
import ConfigJinaReaderModal from './config-jina-reader-modal'
import cn from '@/utils/classnames'
import s from '@/app/components/datasets/create/website/index.module.css'
import { fetchDataSources, removeDataSourceApiKeyBinding } from '@/service/datasets'

import type { DataSourceItem } from '@/models/common'
import { DataSourceProvider } from '@/models/common'
import { useAppContext } from '@/context/app-context'
import Toast from '@/app/components/base/toast'

type Props = {
  provider: DataSourceProvider
}

const DataSourceWebsite: FC<Props> = ({ provider }) => {
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
  }, [])

  const [configTarget, setConfigTarget] = useState<DataSourceProvider | null>(null)
  const showConfig = useCallback((provider: DataSourceProvider) => {
    setConfigTarget(provider)
  }, [setConfigTarget])

  const hideConfig = useCallback(() => {
    setConfigTarget(null)
  }, [setConfigTarget])

  const handleAdded = useCallback(() => {
    checkSetApiKey()
    hideConfig()
  }, [checkSetApiKey, hideConfig])

  const getIdByProvider = (provider: DataSourceProvider): string | undefined => {
    const source = sources.find(item => item.provider === provider)
    return source?.id
  }

  const getProviderName = (provider: DataSourceProvider): string => {
    if (provider === DataSourceProvider.fireCrawl)
      return 'Firecrawl'

    if (provider === DataSourceProvider.waterCrawl)
      return 'WaterCrawl'

    return 'Jina Reader'
  }

  const handleRemove = useCallback((provider: DataSourceProvider) => {
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
        provider={provider}
        isConfigured={sources.find(item => item.provider === provider) !== undefined}
        onConfigure={() => showConfig(provider)}
        readOnly={!isCurrentWorkspaceManager}
        configuredList={sources.filter(item => item.provider === provider).map(item => ({
          id: item.id,
          logo: ({ className }: { className: string }) => {
            if (item.provider === DataSourceProvider.fireCrawl) {
              return (
                <div
                  className={cn(className, 'ml-3 flex h-5 w-5 items-center justify-center rounded border border-divider-subtle !bg-background-default text-xs font-medium text-text-tertiary')}>🔥</div>
              )
            }

            if (item.provider === DataSourceProvider.waterCrawl) {
              return (
                <div
                  className={cn(className, 'ml-3 flex h-5 w-5 items-center justify-center rounded border border-divider-subtle !bg-background-default text-xs font-medium text-text-tertiary')}>
                  <span className={s.watercrawlLogo}/>
                </div>
              )
            }
            return (
              <div
                className={cn(className, 'ml-3 flex h-5 w-5 items-center justify-center rounded border border-divider-subtle !bg-background-default text-xs font-medium text-text-tertiary')}>
                <span className={s.jinaLogo}/>
              </div>
            )
          },
          name: getProviderName(item.provider),
          isActive: true,
        }))}
        onRemove={handleRemove(provider)}
      />
      {configTarget === DataSourceProvider.fireCrawl && (
        <ConfigFirecrawlModal onSaved={handleAdded} onCancel={hideConfig}/>
      )}
      {configTarget === DataSourceProvider.waterCrawl && (
        <ConfigWatercrawlModal onSaved={handleAdded} onCancel={hideConfig}/>
      )}
      {configTarget === DataSourceProvider.jinaReader && (
        <ConfigJinaReaderModal onSaved={handleAdded} onCancel={hideConfig}/>
      )}
    </>

  )
}
export default React.memo(DataSourceWebsite)
