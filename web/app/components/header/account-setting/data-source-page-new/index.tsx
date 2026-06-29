import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo, useState } from 'react'
import { Trans } from 'react-i18next'
import { useTranslation } from '#i18n'
import { SearchInput } from '@/app/components/base/search-input'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { usePluginsWithLatestVersion } from '@/app/components/plugins/hooks'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { useGetDataSourceListAuth, useInvalidDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import UpdateSettingDialog from '../update-setting-dialog'
import Card from './card'
import InstallFromMarketplace from './install-from-marketplace'

type DataSourcePageProps = {
  layout?: (parts: { body: ReactNode, toolbar: ReactNode }) => ReactNode
  stickyToolbar?: boolean
}

function DataSourceCardSkeleton() {
  return (
    <div className="rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs">
      <SkeletonContainer className="h-20">
        <SkeletonRow>
          <SkeletonRectangle className="size-10 shrink-0 animate-pulse rounded-lg" />
          <div className="flex flex-1 flex-col gap-1">
            <SkeletonRectangle className="h-4 w-2/5 animate-pulse" />
            <SkeletonRectangle className="h-3 w-3/5 animate-pulse" />
          </div>
          <SkeletonRectangle className="h-8 w-20 animate-pulse rounded-lg" />
        </SkeletonRow>
        <SkeletonRectangle className="mt-4 h-3 w-4/5 animate-pulse" />
      </SkeletonContainer>
    </div>
  )
}

function DataSourceListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t('loading', { ns: 'common' })} className="space-y-2">
      {Array.from({ length: 2 }, (_, index) => (
        <DataSourceCardSkeleton key={index} />
      ))}
    </div>
  )
}

const DataSourcePage = ({
  layout,
  stickyToolbar,
}: DataSourcePageProps) => {
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const [searchText, setSearchText] = useState('')
  const {
    canSetPluginPreferences,
  } = usePluginSettingsAccess()
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data, isLoading: isDataSourceListLoading } = useGetDataSourceListAuth()
  const { data: installedPluginList } = useInstalledPluginList()
  const pluginListWithLatestVersion = usePluginsWithLatestVersion(installedPluginList?.plugins)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()
  const invalidateDataSourceList = useInvalidDataSourceList()
  const dataSources = useMemo(() => data?.result ?? [], [data?.result])
  const dataSourcePluginDetails = useMemo(() => {
    return pluginListWithLatestVersion.filter(plugin => plugin.declaration.category === PluginCategoryEnum.datasource)
  }, [pluginListWithLatestVersion])
  const filteredDataSources = useMemo(() => {
    const normalizedSearchText = searchText.trim().toLowerCase()
    if (!normalizedSearchText)
      return dataSources

    return dataSources.filter((item) => {
      const searchableText = [
        item.name,
        item.provider,
        item.author,
        renderI18nObject(item.label),
        renderI18nObject(item.description),
      ].join(' ').toLowerCase()

      return searchableText.includes(normalizedSearchText)
    })
  }, [dataSources, renderI18nObject, searchText])
  const handlePluginUpdate = useCallback(() => {
    invalidateInstalledPluginList()
    invalidateDataSourceListAuth()
    invalidateDataSourceList()
  }, [invalidateDataSourceList, invalidateDataSourceListAuth, invalidateInstalledPluginList])

  const toolbar = (
    <div className={stickyToolbar
      ? layout
        ? 'flex w-full items-center justify-between gap-3'
        : 'sticky top-0 z-10 -mx-6 mb-2 flex items-center justify-between gap-3 bg-components-panel-bg px-6 pb-2'
      : 'mb-2 flex items-center justify-between gap-3'}
    >
      <SearchInput
        className="w-[200px]"
        placeholder={t('operation.search', { ns: 'common' })}
        value={searchText}
        onValueChange={setSearchText}
      />
      {canSetPluginPreferences && (
        <UpdateSettingDialog
          category={PluginCategoryEnum.datasource}
        />
      )}
    </div>
  )

  const body = (
    <>
      {isDataSourceListLoading && <DataSourceListSkeleton />}
      {!isDataSourceListLoading && !dataSources.length && (
        <div className="mb-2 rounded-[10px] bg-workflow-process-bg p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
            <span className="i-ri-database-2-line h-5 w-5 text-text-primary" />
          </div>
          <div className="mt-2 system-sm-medium text-text-secondary">
            <Trans
              i18nKey="dataSourcePage.notSetUpTitle"
              ns="common"
              components={{
                highlight: <span className="text-text-primary" />,
              }}
            />
          </div>
          <div className="mt-1 system-xs-regular text-text-tertiary">
            {t('dataSourcePage.installFirst', { ns: 'common' })}
          </div>
        </div>
      )}
      {!isDataSourceListLoading && !!filteredDataSources.length && (
        <div className="space-y-2">
          {
            filteredDataSources.map((item) => {
              const pluginDetail = dataSourcePluginDetails.find(plugin => plugin.plugin_id === item.plugin_id)

              return (
                <Card
                  key={item.plugin_unique_identifier}
                  item={item}
                  pluginDetail={pluginDetail}
                  onPluginUpdate={handlePluginUpdate}
                />
              )
            })
          }
        </div>
      )}
      {
        !isDataSourceListLoading && enable_marketplace && (
          <InstallFromMarketplace
            providers={dataSources}
            searchText={searchText}
          />
        )
      }
    </>
  )

  if (layout)
    return <div className="relative flex min-h-0 flex-1 flex-col">{layout({ body, toolbar })}</div>

  return (
    <div>
      {toolbar}
      {body}
    </div>
  )
}

export default memo(DataSourcePage)
