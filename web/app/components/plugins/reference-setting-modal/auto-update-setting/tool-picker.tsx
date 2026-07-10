'use client'
import type { FC } from 'react'
import type { ActivePluginType } from '../../marketplace/constants'
import type { PluginCategoryEnum } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import { useInstalledPluginList } from '@/service/use-plugins'
import { PLUGIN_TYPE_SEARCH_MAP } from '../../marketplace/constants'
import { PluginSource } from '../../types'
import NoDataPlaceholder from './no-data-placeholder'
import ToolItem from './tool-item'

type Props = Readonly<{
  trigger: React.ReactNode
  value: string[]
  onChange: (value: string[]) => void
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  integrationCategory?: PluginCategoryEnum
}>

const ToolPicker: FC<Props> = ({
  trigger,
  value,
  onChange,
  isShow,
  onShowChange,
  integrationCategory,
}) => {
  const { t } = useTranslation()

  const allTabs = [
    { key: PLUGIN_TYPE_SEARCH_MAP.all, name: t($ => $['category.all'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.model, name: t($ => $['category.models'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.tool, name: t($ => $['category.tools'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.agent, name: t($ => $['category.agents'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.extension, name: t($ => $['category.extensions'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.datasource, name: t($ => $['category.datasources'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.trigger, name: t($ => $['category.triggers'], { ns: 'plugin' }) },
    { key: PLUGIN_TYPE_SEARCH_MAP.bundle, name: t($ => $['category.bundles'], { ns: 'plugin' }) },
  ]
  const tabs = integrationCategory
    ? allTabs.filter(tab => tab.key === integrationCategory)
    : allTabs

  const [pluginType, setPluginType] = useState<ActivePluginType>(PLUGIN_TYPE_SEARCH_MAP.all)
  const effectivePluginType = integrationCategory ?? pluginType
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const { data, isLoading } = useInstalledPluginList()
  const filteredList = useMemo(() => {
    const list = data ? data.plugins : []
    return list.filter((plugin) => {
      const isFromMarketPlace = plugin.source === PluginSource.marketplace
      return (
        isFromMarketPlace && (effectivePluginType === PLUGIN_TYPE_SEARCH_MAP.all || plugin.declaration.category === effectivePluginType)
        && (tags.length === 0 || tags.some(tag => plugin.declaration.tags.includes(tag)))
        && (query === '' || plugin.plugin_id.toLowerCase().includes(query.toLowerCase()))
      )
    })
  }, [data, effectivePluginType, query, tags])

  const handleCheckChange = (pluginId: string) => {
    const newValue = value.includes(pluginId)
      ? value.filter(id => id !== pluginId)
      : [...value, pluginId]
    onChange(newValue)
  }

  const listContent = (
    <div className="max-h-[396px] overflow-y-auto p-1">
      {filteredList.map(item => (
        <ToolItem
          key={item.plugin_id}
          payload={item}
          isChecked={value.includes(item.plugin_id)}
          onCheckChange={() => handleCheckChange(item.plugin_id)}
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

  const resolvedTrigger = React.isValidElement(trigger) ? trigger : <div>{trigger}</div>

  return (
    <Popover open={isShow} onOpenChange={onShowChange}>
      <PopoverTrigger render={resolvedTrigger} />
      <PopoverContent
        placement="top"
        sideOffset={4}
        popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="relative min-h-20 w-[432px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-xs">
          <div className="flex flex-col overflow-hidden rounded-t-lg border-b border-divider-subtle bg-background-section-burn">
            <div className="bg-components-panel-bg p-2">
              <SearchBox
                search={query}
                onSearchChange={setQuery}
                tags={tags}
                onTagsChange={setTags}
                placeholder={t($ => $.searchTools, { ns: 'plugin' })!}
                inputClassName="w-full"
              />
            </div>
            <div className="flex items-center justify-between bg-components-panel-bg px-3 pb-2">
              <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
                {tabs.map(tab => (
                  <div
                    className={cn(
                      'flex h-6 shrink-0 cursor-pointer items-center rounded-md px-2 system-xs-medium text-text-tertiary hover:bg-state-base-hover',
                      effectivePluginType === tab.key && 'bg-state-base-hover-alt system-xs-semibold text-text-primary',
                    )}
                    key={tab.key}
                    onClick={() => setPluginType(tab.key)}
                  >
                    {tab.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {!isLoading && filteredList.length > 0 && listContent}
          {!isLoading && filteredList.length === 0 && noData}
          {isLoading && loadingContent}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(ToolPicker)
