'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean, useDebounceFn } from 'ahooks'

// Libraries
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext, useSelector as useAppContextSelector } from '@/context/app-context'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useDatasetApiBaseUrl, useDatasetList, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { systemFeaturesQueryOptions } from '@/service/system-features'
// Components
import FilterEmptyState from '../../base/filter-empty-state'
import ExternalAPIPanel from '../external-api/external-api-panel'
import DatasetFooter from './dataset-footer'
import Datasets from './datasets'
import DatasetFirstEmptyState from './first-empty-state'
import DatasetListHeader from './header'
import DatasetListPageTitle from './page-title'

const List = () => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const searchParams = useSearchParams()
  const { push } = useRouter()
  const { isCurrentWorkspaceOwner } = useAppContext()
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const [includeAll, { toggle: toggleIncludeAll }] = useBoolean(false)
  const invalidDatasetList = useInvalidDatasetList()
  useDocumentTitle(t('knowledge', { ns: 'dataset' }))

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const { run: handleTagsUpdate } = useDebounceFn(() => {
    setTagIDs(tagFilterValue)
  }, { wait: 500 })
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate()
  }

  const isCurrentWorkspaceManager = useAppContextSelector(state => state.isCurrentWorkspaceManager)
  const isCurrentWorkspaceEditor = useAppContextSelector(state => state.isCurrentWorkspaceEditor)
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const emptyDataList = searchParams.get('emptyDataList') === 'true'
  const datasetListQuery = useDatasetList({
    initialPage: 1,
    tag_ids: tagIDs,
    limit: 30,
    include_all: includeAll,
    keyword: searchKeywords,
  })
  const pages = useMemo(() => emptyDataList ? [{ data: [], total: 0 }] : datasetListQuery.data?.pages ?? [], [datasetListQuery.data?.pages, emptyDataList])
  const hasResolvedFirstPage = pages.length > 0
  const hasAnyDataset = (pages[0]?.total ?? 0) > 0
  const hasActiveFilters = tagIDs.length > 0 || keywords.trim().length > 0 || searchKeywords.trim().length > 0 || includeAll
  const showEmptyDataList = !hasAnyDataset && isCurrentWorkspaceEditor && (emptyDataList || (hasResolvedFirstPage && !hasActiveFilters))
  const showFilteredEmptyState = !hasAnyDataset && hasResolvedFirstPage && hasActiveFilters

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      {showEmptyDataList
        ? (
            <>
              <div className="sticky top-0 z-10 flex flex-col bg-background-body px-6 pt-2 pb-2">
                <div className="flex min-h-14 items-start pt-2">
                  <DatasetListPageTitle
                    title={t('knowledge', { ns: 'dataset' })}
                    description={t('studioDescription', { ns: 'dataset' })}
                    titleClassName="text-dify-logo-black"
                  />
                </div>
              </div>
              <DatasetFirstEmptyState />
            </>
          )
        : (
            <>
              <DatasetListHeader
                apiBaseUrl={apiBaseInfo?.api_base_url ?? ''}
                includeAll={includeAll}
                isCurrentWorkspaceEditor={isCurrentWorkspaceEditor}
                isCurrentWorkspaceManager={isCurrentWorkspaceManager}
                isCurrentWorkspaceOwner={isCurrentWorkspaceOwner}
                keywords={keywords}
                tagFilterValue={tagFilterValue}
                onCreateDataset={() => push('/datasets/create')}
                onCreateFromPipeline={() => push('/datasets/create-from-pipeline')}
                onConnectDataset={() => push('/datasets/connect')}
                onExternalApiClick={() => setShowExternalApiPanel(true)}
                onIncludeAllChange={toggleIncludeAll}
                onKeywordsChange={handleKeywordsChange}
                onOpenTagManagement={() => setShowTagManagementModal(true)}
                onTagsChange={handleTagsChange}
              />
              <Datasets
                datasetList={datasetListQuery.data}
                emptyElement={showFilteredEmptyState ? <FilterEmptyState title={t('filterEmpty.noKnowledge', { ns: 'dataset' })} /> : undefined}
                fetchNextPage={datasetListQuery.fetchNextPage}
                hasNextPage={datasetListQuery.hasNextPage}
                isFetching={datasetListQuery.isFetching}
                isFetchingNextPage={datasetListQuery.isFetchingNextPage}
                onOpenTagManagement={() => setShowTagManagementModal(true)}
              />
              {!systemFeatures.branding.enabled && <DatasetFooter />}
            </>
          )}
      <TagManagementModal
        type="knowledge"
        show={showTagManagementModal}
        onClose={() => setShowTagManagementModal(false)}
        onTagsChange={invalidDatasetList}
      />
      {showExternalApiPanel && <ExternalAPIPanel onClose={() => setShowExternalApiPanel(false)} />}
    </div>
  )
}

export default List
