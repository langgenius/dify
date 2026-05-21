'use client'
import type { RefObject } from 'react'
import type { ToolsContentInset } from './content-inset'
import type { Collection } from './types'
import type { CardPayload } from '@/app/components/plugins/card'
import type { ToolCategory } from '@/app/components/tools/integration-routes'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import UpdateSettingPopover from '@/app/components/header/account-setting/update-setting-popover'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { useTags } from '@/app/components/plugins/hooks'
import Empty from '@/app/components/plugins/marketplace/empty'
import PluginDetailPanel from '@/app/components/plugins/plugin-detail-panel'
import { useCanSetPluginSettings } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import LabelFilter from '@/app/components/tools/labels/filter'
import CustomCreateCard from '@/app/components/tools/provider/custom-create-card'
import ProviderDetail from '@/app/components/tools/provider/detail'
import WorkflowToolEmpty from '@/app/components/tools/provider/empty'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useCheckInstalled, useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { useAllToolProviders } from '@/service/use-tools'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from './content-inset'
import { useToolMarketplacePanel } from './hooks/use-tool-marketplace-panel'
import { useToolProviderCategory } from './hooks/use-tool-provider-category'
import Marketplace from './marketplace'
import MCPList from './mcp'
import { getToolType } from './utils'

type ProviderListProps = {
  category?: ToolCategory
  contentInset?: ToolsContentInset
}

type BuiltinMarketplacePanelProps = {
  containerRef: RefObject<HTMLDivElement | null>
  contentInset: ToolsContentInset
  keywords: string
  tagFilterValue: string[]
}

const getCollectionPluginIdentity = (collection: Collection) => {
  const [org, ...nameParts] = collection.plugin_id?.split('/').filter(Boolean) ?? []

  if (org && nameParts.length) {
    return {
      org,
      name: nameParts.join('/'),
    }
  }

  return {
    org: '',
    name: collection.name,
  }
}

const collectionToCardPayload = (collection: Collection): CardPayload => {
  const { org, name } = getCollectionPluginIdentity(collection)

  return {
    ...collection,
    type: 'tool',
    org,
    name,
    plugin_id: collection.plugin_id ?? collection.id,
    version: '',
    latest_version: '',
    latest_package_identifier: '',
    brief: collection.description,
    description: collection.description,
    introduction: '',
    repository: '',
    category: PluginCategoryEnum.tool,
    install_count: 0,
    endpoint: {
      settings: [],
    },
    tags: collection.labels?.map(name => ({ name })) ?? [],
    badges: [],
    verification: {
      authorized_category: 'community',
    },
    verified: false,
    from: collection.plugin_id ? 'marketplace' : 'package',
  }
}

const BuiltinMarketplacePanel = ({
  containerRef,
  contentInset,
  keywords,
  tagFilterValue,
}: BuiltinMarketplacePanelProps) => {
  const {
    isMarketplaceArrowVisible,
    marketplaceContext,
    showMarketplacePanel,
    toolListTailRef,
  } = useToolMarketplacePanel({
    containerRef,
    keywords,
    tagFilterValue,
  })

  return (
    <>
      <div ref={toolListTailRef} />
      <Marketplace
        searchPluginText={keywords}
        filterPluginTags={tagFilterValue}
        isMarketplaceArrowVisible={isMarketplaceArrowVisible}
        showMarketplacePanel={showMarketplacePanel}
        marketplaceContext={marketplaceContext}
        contentInset={contentInset}
      />
    </>
  )
}

const ProviderList = ({
  category,
  contentInset = 'default',
}: ProviderListProps) => {
  // const searchParams = useSearchParams()
  // searchParams.get('category') === 'workflow'
  const { t } = useTranslation()
  const { getTagLabel } = useTags()
  const {
    canSetPermissions,
  } = useCanSetPluginSettings()
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { activeTab, handleCategoryChange, isRouteCategory } = useToolProviderCategory(category)
  const contentPaddingClassName = toolsContentInsetClassNames[contentInset]
  const toolListFrameClassName = cn(contentPaddingClassName, toolsUnifiedContentFrameClassName)
  const showToolsUpdateSetting = activeTab === 'builtin' && canSetPermissions
  const showLabelFilter = activeTab === 'builtin'
  const options = [
    { value: 'builtin', text: t('type.builtIn', { ns: 'tools' }) },
    { value: 'api', text: t('type.custom', { ns: 'tools' }) },
    { value: 'workflow', text: t('type.workflow', { ns: 'tools' }) },
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
      if (showLabelFilter && tagFilterValue.length > 0 && (!collection.labels || collection.labels.every(label => !tagFilterValue.includes(label))))
        return false
      if (keywords)
        return Object.values(collection.label).some(value => value.toLowerCase().includes(keywords.toLowerCase()))
      return true
    })
  }, [activeTab, showLabelFilter, tagFilterValue, keywords, collectionList])

  const [currentProviderId, setCurrentProviderId] = useState<string | undefined>()
  const currentProvider = useMemo<Collection | undefined>(() => {
    return filteredCollectionList.find(collection => collection.id === currentProviderId)
  }, [currentProviderId, filteredCollectionList])
  const { data: checkedInstalledData } = useCheckInstalled({
    pluginIds: currentProvider?.plugin_id ? [currentProvider.plugin_id] : [],
    enabled: !!currentProvider?.plugin_id,
  })
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const currentPluginDetail = useMemo(() => {
    return checkedInstalledData?.plugins?.[0]
  }, [checkedInstalledData])
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <div className="relative flex h-0 shrink-0 grow overflow-hidden">
        <div
          ref={containerRef}
          className="relative flex grow flex-col overflow-y-auto bg-components-panel-bg"
        >
          <div
            className={cn(
              'sticky top-0 z-10 flex flex-wrap items-center justify-start gap-x-2 gap-y-2 bg-components-panel-bg pt-2 pb-0',
              toolListFrameClassName,
              currentProviderId && 'pr-6',
            )}
          >
            {!isRouteCategory && (
              <TabSliderNew
                value={activeTab}
                onChange={state => handleCategoryChange(state, () => setCurrentProviderId(undefined))}
                options={options}
              />
            )}
            <div className="flex min-w-[200px] flex-1 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {showLabelFilter && (
                  <LabelFilter value={tagFilterValue} onChange={handleTagsChange} />
                )}
                <Input
                  showLeftIcon
                  showClearIcon
                  wrapperClassName="w-[200px]"
                  value={keywords}
                  onChange={e => handleKeywordsChange(e.target.value)}
                  onClear={() => handleKeywordsChange('')}
                />
              </div>
              {showToolsUpdateSetting && (
                <UpdateSettingPopover
                  category={PluginCategoryEnum.tool}
                />
              )}
            </div>
          </div>
          {activeTab !== 'mcp' && (
            <div
              className={cn(
                'relative grid shrink-0 grid-cols-1 content-start gap-2 pt-2 pb-4 sm:grid-cols-2 md:grid-cols-3',
                toolListFrameClassName,
                !filteredCollectionList.length && activeTab === 'workflow' && 'grow',
              )}
            >
              {activeTab === 'api' && <CustomCreateCard onRefreshData={refetch} />}
              {filteredCollectionList.map(collection => (
                <div
                  key={collection.id}
                  onClick={() => setCurrentProviderId(collection.id)}
                >
                  <Card
                    className={cn(
                      'cursor-pointer',
                      currentProviderId === collection.id && 'border-[1.5px] border-components-option-card-option-selected-border',
                    )}
                    hideCornerMark
                    payload={collectionToCardPayload(collection)}
                    footer={(
                      <CardMoreInfo
                        tags={collection.labels?.map(label => getTagLabel(label)) || []}
                      />
                    )}
                  />
                </div>
              ))}
              {!filteredCollectionList.length && activeTab === 'workflow' && (
                <div className="absolute top-1/2 left-1/2 w-full max-w-[1060px] -translate-x-1/2 -translate-y-1/2 px-6">
                  <WorkflowToolEmpty type={getToolType(activeTab)} />
                </div>
              )}
            </div>
          )}
          {!filteredCollectionList.length && activeTab === 'builtin' && (
            <Empty lightCard text={t('noTools', { ns: 'tools' })} className={cn('h-[224px] shrink-0', toolListFrameClassName)} />
          )}
          {enable_marketplace && activeTab === 'builtin' && (
            <BuiltinMarketplacePanel
              containerRef={containerRef}
              contentInset={contentInset}
              keywords={keywords}
              tagFilterValue={tagFilterValue}
            />
          )}
          {activeTab === 'mcp' && (
            <MCPList searchText={keywords} contentInset={contentInset} />
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
