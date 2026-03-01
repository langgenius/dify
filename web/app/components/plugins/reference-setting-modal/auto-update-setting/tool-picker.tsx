'use client'
import type { FC } from 'react'
import type { ActivePluginType } from '../../marketplace/constants'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import { useInstalledPluginList } from '@/service/use-plugins'
import { cn } from '@/utils/classnames'
import { PLUGIN_TYPE_SEARCH_MAP } from '../../marketplace/constants'
import { PluginSource } from '../../types'
import NoDataPlaceholder from './no-data-placeholder'
import ToolItem from './tool-item'

type Props = {
  trigger: React.ReactNode
  value: string[]
  onChange: (value: string[]) => void
  isShow: boolean
  onShowChange: (isShow: boolean) => void

}

const ToolPicker: FC<Props> = ({
  trigger,
  value,
  onChange,
  isShow,
  onShowChange,
}) => {
  const { t } = useTranslation()
  const toggleShowPopup = useCallback(() => {
    onShowChange(!isShow)
  }, [onShowChange, isShow])

  const tabs = [
    {
      key: PLUGIN_TYPE_SEARCH_MAP.all,
      name: t('category.all', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.model,
      name: t('category.models', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.tool,
      name: t('category.tools', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.agent,
      name: t('category.agents', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.extension,
      name: t('category.extensions', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.datasource,
      name: t('category.datasources', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.trigger,
      name: t('category.triggers', { ns: 'plugin' }),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.bundle,
      name: t('category.bundles', { ns: 'plugin' }),
    },
  ]

  const [pluginType, setPluginType] = useState<ActivePluginType>(PLUGIN_TYPE_SEARCH_MAP.all)
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const { data, isLoading } = useInstalledPluginList()
  const filteredList = useMemo(() => {
    const list = data ? data.plugins : []
    return list.filter((plugin) => {
      const isFromMarketPlace = plugin.source === PluginSource.marketplace
      return (
        isFromMarketPlace && (pluginType === PLUGIN_TYPE_SEARCH_MAP.all || plugin.declaration.category === pluginType)
        && (tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && (query === '' || plugin.plugin_id.toLowerCase().includes(query.toLowerCase()))
      )
    })
  }, [data, pluginType, query, tags])
  const handleCheckChange = useCallback((pluginId: string) => {
    return () => {
      const newValue = value.includes(pluginId)
        ? value.filter(id => id !== pluginId)
        : [...value, pluginId]
      onChange(newValue)
    }
  }, [onChange, value])

  const listContent = (
    <div className="max-h-[396px] overflow-y-auto">
      {filteredList.map(item => (
        <ToolItem
          key={item.plugin_id}
          payload={item}
          isChecked={value.includes(item.plugin_id)}
          onCheckChange={handleCheckChange(item.plugin_id)}
        />
      ))}
    </div>
  )

  const loadingContent = (
    <div className="flex h-[396px] items-center justify-center">
      <Loading />
    </div>
  )

  const noData = (
    <NoDataPlaceholder className="h-[396px]" noPlugins={!query} />
  )

  return (
    <PortalToFollowElem
      placement="top"
      offset={0}
      open={isShow}
      onOpenChange={onShowChange}
    >
      <PortalToFollowElemTrigger
        className="block w-full"
        onClick={toggleShowPopup}
      >
        {trigger}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className={cn('relative min-h-20 w-full rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-2 shadow-lg backdrop-blur-sm')}>
          <div className="p-2 pb-1">
            <SearchBox
              search={query}
              onSearchChange={setQuery}
              tags={tags}
              onTagsChange={setTags}
              placeholder={t('searchTools', { ns: 'plugin' })!}
              inputClassName="w-full"
            />
          </div>
          <div className="flex items-center justify-between border-b-[0.5px] border-divider-subtle bg-background-default-hover px-3 shadow-xs">
            <div className="flex h-8 items-center space-x-1">
              {
                tabs.map(tab => (
                  <div
                    className={cn(
                      'flex h-6 cursor-pointer items-center rounded-md px-2 hover:bg-state-base-hover',
                      'text-xs font-medium text-text-secondary',
                      pluginType === tab.key && 'bg-state-base-hover-alt',
                    )}
                    key={tab.key}
                    onClick={() => setPluginType(tab.key)}
                  >
                    {tab.name}
                  </div>
                ))
              }
            </div>
          </div>
          {!isLoading && filteredList.length > 0 && listContent}
          {!isLoading && filteredList.length === 0 && noData}
          {isLoading && loadingContent}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(ToolPicker)
