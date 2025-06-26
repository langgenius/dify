'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useFetchPluginListOrBundleList } from '@/service/use-plugins'
import { PLUGIN_TYPE_SEARCH_MAP } from '../../marketplace/plugin-type-switch'
import SearchBox from '@/app/components/plugins/marketplace/search-box'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

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
      name: t('plugin.category.all'),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.model,
      name: t('plugin.category.models'),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.tool,
      name: t('plugin.category.tools'),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.agent,
      name: t('plugin.category.agents'),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.extension,
      name: t('plugin.category.extensions'),
    },
    {
      key: PLUGIN_TYPE_SEARCH_MAP.bundle,
      name: t('plugin.category.bundles'),
    },
  ]

  const [pluginType, setPluginType] = useState(PLUGIN_TYPE_SEARCH_MAP.all)
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const { data } = useFetchPluginListOrBundleList({
    query,
    tags,
    category: pluginType,
  })
  const isBundle = pluginType === PLUGIN_TYPE_SEARCH_MAP.bundle
  const list = (isBundle ? data?.data?.bundles : data?.data?.plugins) || []

  console.log(list)
  return (
    <PortalToFollowElem
        placement='top-start'
        offset={0}
        open={true}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          onClick={toggleShowPopup}
        >
          {trigger}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className={cn('relative min-h-20 w-[356px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-2 shadow-lg backdrop-blur-sm')}>
            <div className='p-2 pb-1'>
              <SearchBox
                search={query}
                onSearchChange={setQuery}
                tags={tags}
                onTagsChange={setTags}
                size='small'
                placeholder={t('plugin.searchTools')!}
                inputClassName='w-full'
              />
            </div>
            <div className='flex items-center justify-between border-b-[0.5px] border-divider-subtle bg-background-default-hover px-3 shadow-xs'>
              <div className='flex h-8 items-center space-x-1'>
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
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
  )
}
export default React.memo(ToolPicker)
