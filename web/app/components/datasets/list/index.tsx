'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
// Libraries
import { useBoolean } from 'ahooks'
import { useDebouncedValue } from 'foxact/use-debounced-value'
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
import { useDocLink } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { KnowledgeViewSwitcher } from '@/features/new-rag/list/knowledge-view-switcher'
import { NewKnowledgeList } from '@/features/new-rag/list/new-knowledge-list'
import { KnowledgeUpgradeProvider } from '@/features/new-rag/upgrade/knowledge-upgrade-context'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
// Components
import FilterEmptyState from '../../base/filter-empty-state'
import { creatorIdsParser } from '../creator-filter-query'
import Datasets from './datasets'
import DatasetFirstEmptyState from './first-empty-state'
import DatasetListHeader from './header'
import { KnowledgeListTitleBar } from './title-bar'
import { useDatasetList, useInvalidDatasetList } from './use-dataset-list'

const knowledgeViewParser = parseAsStringLiteral(['classic', 'agent']).withDefault('classic')

function LegacyList() {
  const { t } = useTranslation(['dataset'])
  const { push } = useRouter()
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [includeAll, { toggle: toggleIncludeAll }] = useBoolean(false)
  const invalidDatasetList = useInvalidDatasetList()
  useDocumentTitle(t(($) => $.knowledge, { ns: 'dataset' }))

  const [keywords, setKeywords] = useState('')
  const debouncedKeywords = useDebouncedValue(keywords, 500)
  const searchKeywords = keywords ? debouncedKeywords : ''
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const [creatorIDs, setCreatorIDs] = useQueryState('creator_ids', creatorIdsParser)
  const debouncedTagIDs = useDebouncedValue(tagFilterValue, 500)
  const tagIDs = tagFilterValue.length > 0 ? debouncedTagIDs : []

  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnectExternalDataset = hasPermission(
    workspacePermissionKeys,
    'dataset.external.connect',
  )
  const datasetListQuery = useDatasetList({
    creatorIds: creatorIDs,
    includeAll,
    keyword: searchKeywords,
    tagIds: tagIDs,
  })
  const pages = datasetListQuery.data?.pages ?? []
  const hasResolvedFirstPage = pages.length > 0
  const hasAnyDataset = (pages[0]?.total ?? 0) > 0
  const hasActiveFilters =
    tagIDs.length > 0 ||
    creatorIDs.length > 0 ||
    keywords.trim().length > 0 ||
    searchKeywords.trim().length > 0 ||
    includeAll
  const showEmptyDataList = !hasAnyDataset && hasResolvedFirstPage && !hasActiveFilters
  const showFilteredEmptyState = !hasAnyDataset && hasResolvedFirstPage && hasActiveFilters
  const filtersHaveSettled =
    keywords === searchKeywords &&
    tagFilterValue.length === tagIDs.length &&
    tagFilterValue.every((id, index) => id === tagIDs[index])
  const announceFilteredEmptyState =
    showFilteredEmptyState &&
    filtersHaveSettled &&
    !datasetListQuery.isFetching &&
    !datasetListQuery.isPlaceholderData &&
    !datasetListQuery.isError
  const filteredEmptyMessage = t(($) => $['filterEmpty.noKnowledge'], { ns: 'dataset' })
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
        canConnectExternalDataset={canConnectExternalDataset}
        canCreateDataset={canCreateDataset}
        creatorFilterValue={creatorIDs}
        includeAll={includeAll}
        isCurrentWorkspaceOwner={isCurrentWorkspaceOwner}
        keywords={keywords}
        tagFilterValue={tagFilterValue}
        onCreateDataset={() => push('/datasets/create')}
        onCreateFromPipeline={() => push('/datasets/create-from-pipeline')}
        onConnectDataset={() => push('/datasets/connect')}
        onCreatorsChange={(value) => void setCreatorIDs(value)}
        onIncludeAllChange={toggleIncludeAll}
        onKeywordsChange={setKeywords}
        onOpenTagManagement={() => setShowTagManagementModal(true)}
        onTagsChange={setTagFilterValue}
        stepByStepTourCreateMenuOpen={
          activeKnowledgeGuide ? shouldOpenStepByStepTourCreateMenu : undefined
        }
        stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
        stepByStepTourCreateMenuHighlightPart={
          STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu
        }
      />
      <div role="status" aria-atomic="true" className="sr-only">
        {announceFilteredEmptyState ? filteredEmptyMessage : ''}
      </div>
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
              <FilterEmptyState title={<span aria-hidden="true">{filteredEmptyMessage}</span>} />
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
    </div>
  )
}

function KnowledgeFsList() {
  const docLink = useDocLink()
  const [view, setView] = useQueryState('view', knowledgeViewParser)

  return (
    <KnowledgeUpgradeProvider onUpgradeStarted={() => void setView('agent')}>
      <div className="flex min-h-0 grow flex-col bg-background-body">
        <KnowledgeListTitleBar
          apiReferenceUrl={
            view === 'agent' ? docLink('/api-reference/guides/knowledge-base') : undefined
          }
          className={view === 'agent' ? 'px-4 sm:px-8' : 'px-8'}
          viewSwitcher={
            <KnowledgeViewSwitcher value={view} onChange={(nextView) => void setView(nextView)} />
          }
        />
        {view === 'agent' ? <NewKnowledgeList /> : <LegacyList />}
      </div>
    </KnowledgeUpgradeProvider>
  )
}

function List() {
  const { data: knowledgeFsEnabled } = useSuspenseQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.enable_knowledge_fs,
    }),
  )

  if (!knowledgeFsEnabled) {
    return (
      <div className="flex min-h-0 grow flex-col bg-background-body">
        <KnowledgeListTitleBar className="px-8" />
        <LegacyList />
      </div>
    )
  }

  return <KnowledgeFsList />
}

export default List
