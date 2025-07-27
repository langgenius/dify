'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import MCPList from './mcp'
import { useAllToolProviders } from '@/service/use-tools'
import { useInstalledPluginList, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { ToolTypeEnum } from '../workflow/block-selector/types'
import { useMarketplace } from './marketplace/hooks'

const getToolType = (type: string) => {
  switch (type) {
    case 'builtin':
      return ToolTypeEnum.BuiltIn
    case 'api':
      return ToolTypeEnum.Custom
    case 'workflow':
      return ToolTypeEnum.Workflow
    case 'mcp':
      return ToolTypeEnum.MCP
    default:
      return ToolTypeEnum.BuiltIn
  }
}
const ProviderList = () => {
  // const searchParams = useSearchParams()
  // searchParams.get('category') === 'workflow'
  const { t } = useTranslation()
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const containerRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'builtin',
  })
  const options = [
    { value: 'builtin', text: t('tools.type.builtIn') },
    { value: 'api', text: t('tools.type.custom') },
    { value: 'workflow', text: t('tools.type.workflow') },
    { value: 'mcp', text: 'MCP' },
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

  const [currentProviderId, setCurrentProviderId] = useState<string | undefined>()
  const currentProvider = useMemo<Collection | undefined>(() => {
    return filteredCollectionList.find(collection => collection.id === currentProviderId)
  }, [currentProviderId, filteredCollectionList])
  const { data: pluginList } = useInstalledPluginList()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginDetail = useMemo(() => {
    const detail = pluginList?.plugins.find(plugin => plugin.plugin_id === currentProvider?.plugin_id)
    return detail
  }, [currentProvider?.plugin_id, pluginList?.plugins])

  const toolListTailRef = useRef<HTMLDivElement>(null)
  const showMarketplacePanel = useCallback(() => {
    containerRef.current?.scrollTo({
      top: toolListTailRef.current
        ? toolListTailRef.current?.offsetTop - 80
        : 0,
      behavior: 'smooth',
    })
  }, [toolListTailRef])

  const marketplaceContext = useMarketplace(keywords, tagFilterValue)
  const {
    handleScroll,
  } = marketplaceContext

  const [isMarketplaceArrowVisible, setIsMarketplaceArrowVisible] = useState(true)
  const onContainerScroll = useMemo(() => {
    return (e: Event) => {
      handleScroll(e)
      if (containerRef.current && toolListTailRef.current)
        setIsMarketplaceArrowVisible(containerRef.current.scrollTop < (toolListTailRef.current?.offsetTop - 80))
    }
  }, [handleScroll, containerRef, toolListTailRef, setIsMarketplaceArrowVisible])

  useEffect(() => {
    const container = containerRef.current
    if (container)
      container.addEventListener('scroll', onContainerScroll)

    return () => {
      if (container)
        container.removeEventListener('scroll', onContainerScroll)
    }
  }, [onContainerScroll])

  return (
    <>
      <div className='relative flex h-0 shrink-0 grow overflow-hidden'>
        <div
          ref={containerRef}
          className='relative flex grow flex-col overflow-y-auto bg-background-body'
        >
          <div className={cn(
            'sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 bg-background-body px-12 pb-2 pt-4 leading-[56px]',
            currentProviderId && 'pr-6',
          )}>
            <TabSliderNew
              value={activeTab}
              onChange={(state) => {
                setActiveTab(state)
                if (state !== activeTab)
                  setCurrentProviderId(undefined)
              }}
              options={options}
            />
            <div className='flex items-center gap-2'>
              {activeTab !== 'mcp' && (
                <LabelFilter value={tagFilterValue} onChange={handleTagsChange} />
              )}
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
          {activeTab !== 'mcp' && (
            <div className={cn(
              'relative grid shrink-0 grid-cols-1 content-start gap-4 px-12 pb-4 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
              !filteredCollectionList.length && activeTab === 'workflow' && 'grow',
            )}>
              {activeTab === 'api' && <CustomCreateCard onRefreshData={refetch} />}
              {filteredCollectionList.map(collection => (
                <div
                  key={collection.id}
                  onClick={() => setCurrentProviderId(collection.id)}
                >
                  <Card
                    className={cn(
                      'cursor-pointer border-[1.5px] border-transparent',
                      currentProviderId === collection.id && 'border-components-option-card-option-selected-border',
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
              {!filteredCollectionList.length && activeTab === 'workflow' && <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'><WorkflowToolEmpty type={getToolType(activeTab)} /></div>}
            </div>
          )}
          {!filteredCollectionList.length && activeTab === 'builtin' && (
            <Empty lightCard text={t('tools.noTools')} className='h-[224px] shrink-0 px-12' />
          )}
          <div ref={toolListTailRef} />
          {enable_marketplace && activeTab === 'builtin' && (
            <Marketplace
              searchPluginText={keywords}
              filterPluginTags={tagFilterValue}
              isMarketplaceArrowVisible={isMarketplaceArrowVisible}
              showMarketplacePanel={showMarketplacePanel}
              marketplaceContext={marketplaceContext}
            />
          )}
          {activeTab === 'mcp' && (
            <MCPList searchText={keywords} />
          )}
        </div>
      </div>
      {currentProvider && !currentProvider.plugin_id && (
        <ProviderDetail
          collection={currentProvider}
          onHide={() => setCurrentProviderId(undefined)}
          onRefreshData={refetch}
        />
      )}
      <PluginDetailPanel
        detail={currentPluginDetail}
        onUpdate={() => invalidateInstalledPluginList()}
        onHide={() => setCurrentProviderId(undefined)}
      />
    </>
  )
}
ProviderList.displayName = 'ToolProviderList'
export default ProviderList
