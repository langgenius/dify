'use client'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Collection } from './types'
import Marketplace from './marketplace'
import cn from '@/utils/classnames'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import LabelFilter from '@/app/components/tools/labels/filter'
import Input from '@/app/components/base/input'
import ProviderDetail from '@/app/components/tools/provider/detail'
import Empty from '@/app/components/plugins/marketplace/empty'
import CustomCreateCard from '@/app/components/tools/provider/custom-create-card'
import WorkflowToolEmpty from '@/app/components/tools/add-tool-modal/empty'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { useAllToolProviders } from '@/service/use-tools'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'

const ProviderList = () => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const { enable_marketplace } = useAppContextSelector(s => s.systemFeatures)

  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'builtin',
  })
  const options = [
    { value: 'builtin', text: t('tools.type.builtIn') },
    { value: 'api', text: t('tools.type.custom') },
    { value: 'workflow', text: t('tools.type.workflow') },
  ]
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
  }
  const [keywords, setKeywords] = useState<string>('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }
  const { data: collectionList = [], refetch } = useAllToolProviders()
  const filteredCollectionList = useMemo(() => {
    return collectionList.filter((collection) => {
      if (collection.type !== activeTab)
        return false
      if (tagFilterValue.length > 0 && (!collection.labels || collection.labels.every(label => !tagFilterValue.includes(label))))
        return false
      if (keywords)
        return Object.values(collection.label).some(value => value.toLowerCase().includes(keywords.toLowerCase()))
      return true
    })
  }, [activeTab, tagFilterValue, keywords, collectionList])

  const [currentProvider, setCurrentProvider] = useState<Collection | undefined>()
  const { data: pluginList } = useInstalledPluginList()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginDetail = useMemo(() => {
    const detail = pluginList?.plugins.find(plugin => plugin.plugin_id === currentProvider?.plugin_id)
    return detail
  }, [currentProvider?.plugin_id, pluginList?.plugins])

  return (
    <>
      <div className='relative flex h-0 shrink-0 grow overflow-hidden'>
        <div
          ref={containerRef}
          className='bg-background-body relative flex grow flex-col overflow-y-auto'
        >
          <div className={cn(
            'bg-background-body sticky top-0 z-20 flex flex-wrap items-center justify-between gap-y-2 px-12 pb-2 pt-4 leading-[56px]',
            currentProvider && 'pr-6',
          )}>
            <TabSliderNew
              value={activeTab}
              onChange={(state) => {
                setActiveTab(state)
                if (state !== activeTab)
                  setCurrentProvider(undefined)
              }}
              options={options}
            />
            <div className='flex items-center gap-2'>
              <LabelFilter value={tagFilterValue} onChange={handleTagsChange} />
              <Input
                showLeftIcon
                showClearIcon
                wrapperClassName='w-[200px]'
                value={keywords}
                onChange={e => handleKeywordsChange(e.target.value)}
                onClear={() => handleKeywordsChange('')}
              />
            </div>
          </div>
          {(filteredCollectionList.length > 0 || activeTab !== 'builtin') && (
            <div className={cn(
              'relative grid shrink-0 grid-cols-1 content-start gap-4 px-12 pb-4 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
              !filteredCollectionList.length && activeTab === 'workflow' && 'grow',
            )}>
              {activeTab === 'api' && <CustomCreateCard onRefreshData={refetch} />}
              {filteredCollectionList.map(collection => (
                <div
                  key={collection.id}
                  onClick={() => setCurrentProvider(collection)}
                >
                  <Card
                    className={cn(
                      'cursor-pointer border-[1.5px] border-transparent',
                      currentProvider?.id === collection.id && 'border-components-option-card-option-selected-border',
                    )}
                    hideCornerMark
                    payload={{
                      ...collection,
                      brief: collection.description,
                      org: collection.plugin_id ? collection.plugin_id.split('/')[0] : '',
                      name: collection.plugin_id ? collection.plugin_id.split('/')[1] : collection.name,
                    } as any}
                    footer={
                      <CardMoreInfo
                        tags={collection.labels}
                      />
                    }
                  />
                </div>
              ))}
              {!filteredCollectionList.length && activeTab === 'workflow' && <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'><WorkflowToolEmpty /></div>}
            </div>
          )}
          {!filteredCollectionList.length && activeTab === 'builtin' && (
            <Empty lightCard text={t('tools.noTools')} className='h-[224px] px-12' />
          )}
          {
            enable_marketplace && activeTab === 'builtin' && (
              <Marketplace
                onMarketplaceScroll={() => {
                  containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
                }}
                searchPluginText={keywords}
                filterPluginTags={tagFilterValue}
              />
            )
          }
        </div>
      </div>
      {currentProvider && !currentProvider.plugin_id && (
        <ProviderDetail
          collection={currentProvider}
          onHide={() => setCurrentProvider(undefined)}
          onRefreshData={refetch}
        />
      )}
      <PluginDetailPanel
        detail={currentPluginDetail}
        onUpdate={() => invalidateInstalledPluginList()}
        onHide={() => setCurrentProvider(undefined)}
      />
    </>
  )
}
ProviderList.displayName = 'ToolProviderList'
export default ProviderList
