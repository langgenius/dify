import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import { usePluginsWithLatestVersion } from '@/app/components/plugins/hooks'
import useReferenceSetting from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useGetDataSourceListAuth, useInvalidDataSourceListAuth } from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import UpdateSettingPopover from '../update-setting-popover'
import Card from './card'
import InstallFromMarketplace from './install-from-marketplace'

type DataSourcePageProps = {
  stickyToolbar?: boolean
}

const DataSourcePage = ({
  stickyToolbar,
}: DataSourcePageProps) => {
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const [searchText, setSearchText] = useState('')
  const {
    referenceSetting,
    canSetPermissions,
    setReferenceSettings,
  } = useReferenceSetting()
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { data } = useGetDataSourceListAuth()
  const { data: installedPluginList } = useInstalledPluginList()
  const pluginListWithLatestVersion = usePluginsWithLatestVersion(installedPluginList?.plugins)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const invalidateDataSourceListAuth = useInvalidDataSourceListAuth()
  const invalidateDataSourceList = useInvalidDataSourceList()
  const dataSources = data?.result || []
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

  return (
    <div>
      <div className={stickyToolbar
        ? 'sticky top-0 z-10 -mx-6 mb-2 flex items-center justify-between gap-3 bg-components-panel-bg px-6 pb-2'
        : 'mb-2 flex items-center justify-between gap-3'}
      >
        <SearchInput
          className="w-[200px]"
          placeholder={t('modelProvider.searchModels', { ns: 'common' })}
          value={searchText}
          onChange={setSearchText}
        />
        {canSetPermissions && referenceSetting && (
          <UpdateSettingPopover
            referenceSetting={referenceSetting}
            onSave={setReferenceSettings}
          />
        )}
      </div>
      {!dataSources.length && (
        <div className="mb-2 rounded-[10px] bg-workflow-process-bg p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
            <span className="i-ri-database-2-line h-5 w-5 text-text-primary" />
          </div>
          <div className="mt-2 system-sm-medium text-text-secondary">
            <span className="text-text-primary">{t('settings.dataSource', { ns: 'common' })}</span>
            {' '}
            {t('dataSourcePage.notSetUp', { ns: 'common' })}
          </div>
          <div className="mt-1 system-xs-regular text-text-tertiary">
            {t('dataSourcePage.installFirst', { ns: 'common' })}
          </div>
        </div>
      )}
      {!!filteredDataSources.length && (
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
        enable_marketplace && (
          <InstallFromMarketplace
            providers={dataSources}
            searchText={searchText}
          />
        )
      }
    </div>
  )
}

export default memo(DataSourcePage)
