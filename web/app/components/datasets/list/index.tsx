'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean, useDebounceFn } from 'ahooks'

// Libraries
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { useAppContext, useSelector as useAppContextSelector } from '@/context/app-context'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import useDocumentTitle from '@/hooks/use-document-title'
import { useSearchParams } from '@/next/navigation'
import { useDatasetApiBaseUrl, useDatasetList, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { systemFeaturesQueryOptions } from '@/service/system-features'
// Components
import ExternalAPIPanel from '../external-api/external-api-panel'
import ServiceApi from '../extra-info/service-api'
import DatasetFooter from './dataset-footer'
import Datasets from './datasets'
import DatasetFirstEmptyState from './first-empty-state'

const List = () => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const searchParams = useSearchParams()
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

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      {showEmptyDataList
        ? (
            <>
              <div className="sticky top-0 z-10 flex flex-col bg-background-body px-6 pt-2 pb-2">
                <div className="flex min-h-14 items-start pt-2">
                  <div className="flex flex-col gap-0.5">
                    <h1 className="text-xl/6 font-semibold text-dify-logo-black">{t('knowledge', { ns: 'dataset' })}</h1>
                    <p className="system-sm-regular text-text-tertiary">{t('firstEmpty.headerDescription', { ns: 'dataset' })}</p>
                  </div>
                </div>
              </div>
              <DatasetFirstEmptyState />
            </>
          )
        : (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-end gap-x-1 bg-background-body px-12 pt-4 pb-2">
                <div className="flex items-center justify-center gap-2">
                  {isCurrentWorkspaceOwner && (
                    <CheckboxWithLabel
                      isChecked={includeAll}
                      onChange={toggleIncludeAll}
                      label={t('allKnowledge', { ns: 'dataset' })}
                      labelClassName="system-md-regular text-text-secondary"
                      className="mr-2"
                      tooltip={t('allKnowledgeDescription', { ns: 'dataset' }) as string}
                    />
                  )}
                  <TagFilter type="knowledge" value={tagFilterValue} onChange={handleTagsChange} onOpenTagManagement={() => setShowTagManagementModal(true)} />
                  <Input
                    showLeftIcon
                    showClearIcon
                    wrapperClassName="w-[200px]"
                    value={keywords}
                    onChange={e => handleKeywordsChange(e.target.value)}
                    onClear={() => handleKeywordsChange('')}
                  />
                  {
                    isCurrentWorkspaceManager && (
                      <ServiceApi apiBaseUrl={apiBaseInfo?.api_base_url ?? ''} />
                    )
                  }
                  <div className="h-4 w-px bg-divider-regular" />
                  <Button
                    className="gap-0.5 shadow-xs"
                    onClick={() => setShowExternalApiPanel(true)}
                  >
                    <span className="i-custom-vender-solid-development-api-connection-mod h-4 w-4 text-components-button-secondary-text" />
                    <span className="flex items-center justify-center gap-1 px-0.5 system-sm-medium text-components-button-secondary-text">{t('externalAPIPanelTitle', { ns: 'dataset' })}</span>
                  </Button>
                </div>
              </div>
              <Datasets tags={tagIDs} keywords={searchKeywords} includeAll={includeAll} onOpenTagManagement={() => setShowTagManagementModal(true)} />
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
