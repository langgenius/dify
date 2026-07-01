'use client'

import { useBoolean, useDebounceFn } from 'ahooks'

// Libraries
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useSetStepByStepTourAccountState,
  useStepByStepTourAccountStateValue,
} from '@/app/components/step-by-step-tour/storage'
import { getStepByStepTourGuides, STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { useAppContext, useSelector as useAppContextSelector } from '@/context/app-context'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { useDatasetApiBaseUrl, useDatasetList, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { hasPermission } from '@/utils/permission'
// Components
import FilterEmptyState from '../../base/filter-empty-state'
import ExternalAPIPanel from '../external-api/external-api-panel'
import Datasets from './datasets'
import DatasetFirstEmptyState from './first-empty-state'
import DatasetListHeader from './header'

const List = () => {
  const { t } = useTranslation()
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

  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys)
  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnectExternalDataset = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
  const stepByStepTourAccountState = useStepByStepTourAccountStateValue()
  // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
  const setStepByStepTourAccountState = useSetStepByStepTourAccountState()
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const datasetListQuery = useDatasetList({
    initialPage: 1,
    tag_ids: tagIDs,
    limit: 30,
    include_all: includeAll,
    keyword: searchKeywords,
  })
  const pages = datasetListQuery.data?.pages ?? []
  const hasResolvedFirstPage = pages.length > 0
  const hasAnyDataset = (pages[0]?.total ?? 0) > 0
  const hasActiveFilters = tagIDs.length > 0 || keywords.trim().length > 0 || searchKeywords.trim().length > 0 || includeAll
  const showEmptyDataList = !hasAnyDataset && (canCreateDataset || canConnectExternalDataset) && hasResolvedFirstPage && !hasActiveFilters
  const showFilteredEmptyState = !hasAnyDataset && hasResolvedFirstPage && hasActiveFilters
  const hasKnowledgeWalkthroughPermissions = canCreateDataset && canConnectExternalDataset
  const activeKnowledgeGuideGroup = hasKnowledgeWalkthroughPermissions
    ? showEmptyDataList
      ? 'knowledgeEmpty'
      : hasAnyDataset
        ? 'knowledgeWithDatasets'
        : undefined
    : undefined
  const effectiveActiveKnowledgeGuideGroup = stepByStepTourAccountState.activeGuideGroup ?? activeKnowledgeGuideGroup
  const activeKnowledgeGuides = stepByStepTourAccountState.activeTaskId === 'knowledge' && effectiveActiveKnowledgeGuideGroup
    ? getStepByStepTourGuides('knowledge', effectiveActiveKnowledgeGuideGroup)
    : []
  const activeKnowledgeGuide = activeKnowledgeGuides[stepByStepTourAccountState.activeGuideIndex ?? 0]
  const shouldOpenStepByStepTourCreateMenu = activeKnowledgeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate
  const shouldOpenStepByStepTourDatasetCardActionMenu = activeKnowledgeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard

  useEffect(() => {
    if (stepByStepTourAccountState.activeTaskId !== 'knowledge')
      return
    if (!hasResolvedFirstPage || !activeKnowledgeGuideGroup)
      return
    if (stepByStepTourAccountState.activeGuideGroup === activeKnowledgeGuideGroup)
      return

    // Sync the active walkthrough branch into the tour storage owner after the
    // Knowledge list data resolves.
    // eslint-disable-next-line react/set-state-in-effect
    setStepByStepTourAccountState({
      ...stepByStepTourAccountState,
      activeGuideGroup: activeKnowledgeGuideGroup,
      activeGuideIndex: 0,
    })
  }, [
    activeKnowledgeGuideGroup,
    hasResolvedFirstPage,
    setStepByStepTourAccountState,
    stepByStepTourAccountState,
  ])

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      {showEmptyDataList
        ? (
            <>
              <DatasetListHeader
                apiBaseUrl={apiBaseInfo?.api_base_url ?? ''}
                canConnectExternalDataset={canConnectExternalDataset}
                canCreateDataset={canCreateDataset}
                includeAll={includeAll}
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
                stepByStepTourCreateMenuOpen={activeKnowledgeGuide ? shouldOpenStepByStepTourCreateMenu : undefined}
                stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
                stepByStepTourCreateMenuHighlightPart={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu}
              />
              <DatasetFirstEmptyState
                canConnectExternalDataset={canConnectExternalDataset}
                canCreateDataset={canCreateDataset}
              />
            </>
          )
        : (
            <>
              <DatasetListHeader
                apiBaseUrl={apiBaseInfo?.api_base_url ?? ''}
                canConnectExternalDataset={canConnectExternalDataset}
                canCreateDataset={canCreateDataset}
                includeAll={includeAll}
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
                stepByStepTourCreateMenuOpen={activeKnowledgeGuide ? shouldOpenStepByStepTourCreateMenu : undefined}
                stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
                stepByStepTourCreateMenuHighlightPart={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu}
              />
              <Datasets
                datasetList={datasetListQuery.data}
                emptyElement={showFilteredEmptyState ? <FilterEmptyState title={t('filterEmpty.noKnowledge', { ns: 'dataset' })} /> : undefined}
                fetchNextPage={datasetListQuery.fetchNextPage}
                hasNextPage={datasetListQuery.hasNextPage}
                isFetching={datasetListQuery.isFetching}
                isFetchingNextPage={datasetListQuery.isFetchingNextPage}
                isLoading={datasetListQuery.isLoading}
                isPlaceholderData={datasetListQuery.isPlaceholderData}
                onOpenTagManagement={() => setShowTagManagementModal(true)}
                stepByStepTourActionMenuOpen={activeKnowledgeGuide ? shouldOpenStepByStepTourDatasetCardActionMenu : undefined}
                stepByStepTourActionMenuHighlightPart={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu}
                stepByStepTourCardTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard}
              />
            </>
          )}
      <TagManagementModal
        type="knowledge"
        show={showTagManagementModal}
        onClose={() => setShowTagManagementModal(false)}
        onTagsChange={invalidDatasetList}
      />
      {showExternalApiPanel && canConnectExternalDataset && (
        <ExternalAPIPanel
          canManageExternalKnowledgeApi={canConnectExternalDataset}
          onClose={() => setShowExternalApiPanel(false)}
        />
      )}
    </div>
  )
}

export default List
