'use client'

import type { KnowledgeViewSwitcherProps } from '@/features/new-rag/components/knowledge-view-switcher'
// Libraries
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean, useDebounceFn } from 'ahooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  activeStepByStepTourGuideGroupAtom,
  activeStepByStepTourGuideIndexAtom,
  activeStepByStepTourTaskIdAtom,
  resolveStepByStepTourGuideGroupAtom,
} from '@/app/components/step-by-step-tour/state'
import {
  getStepByStepTourGuides,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { NewKnowledgeList } from '@/features/new-rag/new-knowledge-list'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import {
  useDatasetApiBaseUrl,
  useDatasetList,
  useInvalidDatasetList,
} from '@/service/knowledge/use-dataset'
import { hasPermission } from '@/utils/permission'
// Components
import FilterEmptyState from '../../base/filter-empty-state'
import ExternalAPIPanel from '../external-api/external-api-panel'
import Datasets from './datasets'
import DatasetFirstEmptyState from './first-empty-state'
import DatasetListHeader from './header'

const knowledgeViewParser = parseAsStringLiteral(['legacy', 'new']).withDefault('legacy')

function LegacyList({
  knowledgeViewSwitcherProps,
}: {
  knowledgeViewSwitcherProps?: KnowledgeViewSwitcherProps
}) {
  const { t } = useTranslation()
  const { push } = useRouter()
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const [includeAll, { toggle: toggleIncludeAll }] = useBoolean(false)
  const invalidDatasetList = useInvalidDatasetList()
  useDocumentTitle(t(($) => $.knowledge, { ns: 'dataset' }))

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(
    () => {
      setSearchKeywords(keywords)
    },
    { wait: 500 },
  )
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const { run: handleTagsUpdate } = useDebounceFn(
    () => {
      setTagIDs(tagFilterValue)
    },
    { wait: 500 },
  )
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate()
  }

  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnectExternalDataset = hasPermission(
    workspacePermissionKeys,
    'dataset.external.connect',
  )
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
  const hasActiveFilters =
    tagIDs.length > 0 ||
    keywords.trim().length > 0 ||
    searchKeywords.trim().length > 0 ||
    includeAll
  const showEmptyDataList = !hasAnyDataset && hasResolvedFirstPage && !hasActiveFilters
  const showFilteredEmptyState = !hasAnyDataset && hasResolvedFirstPage && hasActiveFilters
  const activeStepByStepTourTaskId = useAtomValue(activeStepByStepTourTaskIdAtom)
  const activeStepByStepTourGuideIndex = useAtomValue(activeStepByStepTourGuideIndexAtom)
  const activeStepByStepTourGuideGroup = useAtomValue(activeStepByStepTourGuideGroupAtom)
  const resolveStepByStepTourGuideGroup = useSetAtom(resolveStepByStepTourGuideGroupAtom)
  const activeKnowledgeGuideGroup = hasAnyDataset
    ? 'knowledgeWithDatasets'
    : showEmptyDataList && canCreateDataset && canConnectExternalDataset
      ? 'knowledgeEmpty'
      : undefined
  const activeKnowledgeGuides =
    activeStepByStepTourTaskId === 'knowledge' && activeKnowledgeGuideGroup
      ? getStepByStepTourGuides('knowledge', activeKnowledgeGuideGroup)
      : []
  const activeKnowledgeGuide = activeKnowledgeGuides[activeStepByStepTourGuideIndex ?? 0]
  const shouldOpenStepByStepTourCreateMenu =
    activeKnowledgeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate
  const shouldOpenStepByStepTourDatasetCardActionMenu =
    activeKnowledgeGuide?.target === STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard

  useEffect(() => {
    if (activeStepByStepTourTaskId !== 'knowledge') return
    if (!hasResolvedFirstPage || !activeKnowledgeGuideGroup) return
    if (activeStepByStepTourGuideGroup === activeKnowledgeGuideGroup) return

    resolveStepByStepTourGuideGroup({
      taskId: 'knowledge',
      guideGroup: activeKnowledgeGuideGroup,
    })
  }, [
    activeStepByStepTourGuideGroup,
    activeStepByStepTourTaskId,
    activeKnowledgeGuideGroup,
    hasResolvedFirstPage,
    resolveStepByStepTourGuideGroup,
  ])

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
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
        stepByStepTourCreateMenuOpen={
          activeKnowledgeGuide ? shouldOpenStepByStepTourCreateMenu : undefined
        }
        stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
        stepByStepTourCreateMenuHighlightPart={
          STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu
        }
        knowledgeViewSwitcherProps={knowledgeViewSwitcherProps}
      />
      {showEmptyDataList ? (
        <DatasetFirstEmptyState
          canConnectExternalDataset={canConnectExternalDataset}
          canCreateDataset={canCreateDataset}
        />
      ) : (
        <Datasets
          datasetList={datasetListQuery.data}
          emptyElement={
            showFilteredEmptyState ? (
              <FilterEmptyState title={t(($) => $['filterEmpty.noKnowledge'], { ns: 'dataset' })} />
            ) : undefined
          }
          fetchNextPage={datasetListQuery.fetchNextPage}
          hasNextPage={datasetListQuery.hasNextPage}
          isFetching={datasetListQuery.isFetching}
          isFetchingNextPage={datasetListQuery.isFetchingNextPage}
          isLoading={datasetListQuery.isLoading}
          isPlaceholderData={datasetListQuery.isPlaceholderData}
          onOpenTagManagement={() => setShowTagManagementModal(true)}
          stepByStepTourActionMenuHighlightPart={
            STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu
          }
          stepByStepTourActionMenuOpen={shouldOpenStepByStepTourDatasetCardActionMenu}
          stepByStepTourCardTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard}
        />
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

function KnowledgeFsList() {
  const [view, setView] = useQueryState('view', knowledgeViewParser)
  const onViewChange = (nextView: 'legacy' | 'new') => {
    void setView(nextView)
  }

  if (view === 'new') return <NewKnowledgeList view={view} onViewChange={onViewChange} />

  return (
    <LegacyList
      knowledgeViewSwitcherProps={{
        value: view,
        onChange: onViewChange,
      }}
    />
  )
}

function List() {
  const { data: knowledgeFsEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ knowledge_fs_enabled }) => knowledge_fs_enabled,
  })

  if (!knowledgeFsEnabled) return <LegacyList />

  return <KnowledgeFsList />
}

export default List
