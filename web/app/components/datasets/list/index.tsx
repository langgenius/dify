'use client'

// Libraries
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
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
import { systemFeaturesAtom } from '@/context/system-features-state'
import { isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { NewKnowledgeList } from '@/features/new-rag/new-knowledge-list'
import {
  useNewKnowledgeGuideDismissedValue,
  useSetNewKnowledgeGuideDismissed,
} from '@/features/new-rag/storage'
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

type LegacyListProps = {
  viewSwitcher?: ReactNode
}

const LegacyList = ({ viewSwitcher }: LegacyListProps) => {
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
  const showEmptyDataList =
    !hasAnyDataset &&
    (canCreateDataset || canConnectExternalDataset) &&
    hasResolvedFirstPage &&
    !hasActiveFilters
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
      {showEmptyDataList ? (
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
            stepByStepTourCreateMenuOpen={
              activeKnowledgeGuide ? shouldOpenStepByStepTourCreateMenu : undefined
            }
            stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
            stepByStepTourCreateMenuHighlightPart={
              STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu
            }
            viewSwitcher={viewSwitcher}
          />
          <DatasetFirstEmptyState
            canConnectExternalDataset={canConnectExternalDataset}
            canCreateDataset={canCreateDataset}
          />
        </>
      ) : (
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
            stepByStepTourCreateMenuOpen={
              activeKnowledgeGuide ? shouldOpenStepByStepTourCreateMenu : undefined
            }
            stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
            stepByStepTourCreateMenuHighlightPart={
              STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu
            }
            viewSwitcher={viewSwitcher}
          />
          <Datasets
            datasetList={datasetListQuery.data}
            emptyElement={
              showFilteredEmptyState ? (
                <FilterEmptyState
                  title={t(($) => $['filterEmpty.noKnowledge'], { ns: 'dataset' })}
                />
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

const knowledgeViewParser = parseAsStringLiteral(['legacy', 'new']).withDefault('legacy')
const KnowledgeViewSwitcher = ({
  value,
  onChange,
}: {
  value: 'legacy' | 'new'
  onChange: (value: 'legacy' | 'new') => void
}) => {
  const { t } = useTranslation('dataset')
  const guideDismissed = useNewKnowledgeGuideDismissedValue()
  const setGuideDismissed = useSetNewKnowledgeGuideDismissed()
  const [guideOpen, setGuideOpen] = useState(!guideDismissed)

  const dismissGuide = () => {
    setGuideDismissed(true)
    setGuideOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <SegmentedControl
        className="rounded-md p-px"
        aria-label={t(($) => $['newKnowledge.viewLabel'])}
        value={[value]}
        onValueChange={(values) => {
          const nextValue = values[0]
          if (nextValue === 'legacy' || nextValue === 'new') onChange(nextValue)
        }}
      >
        <SegmentedControlItem
          className="h-[22px] rounded-md px-1 py-px system-xs-medium"
          value="legacy"
        >
          {t(($) => $['newKnowledge.legacy'])}
        </SegmentedControlItem>
        <SegmentedControlItem
          className="h-[22px] rounded-md py-px pr-5 pl-1 system-xs-medium"
          value="new"
        >
          {t(($) => $['newKnowledge.new'])}
        </SegmentedControlItem>
      </SegmentedControl>
      <Popover open={guideOpen} onOpenChange={setGuideOpen}>
        <PopoverTrigger
          aria-label={t(($) => $['newKnowledge.guideTitle'])}
          render={
            <button
              type="button"
              className="absolute top-[5px] right-1 z-10 flex size-3.5 items-center justify-center rounded-sm text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span aria-hidden className="i-ri-question-line size-3.5" />
            </button>
          }
        />
        <PopoverContent
          placement="bottom"
          sideOffset={13}
          popupClassName="relative h-[162px] w-80 px-4 pt-3.5 pb-4"
        >
          <span
            aria-hidden
            className="absolute -top-[9.59px] left-1/2 flex size-[19.456px] -translate-x-1/2 items-center justify-center"
          >
            <span className="size-[13.757px] -rotate-45 rounded-tr-[2px] border-t border-r border-divider-subtle bg-components-panel-bg" />
          </span>
          <PopoverTitle className="system-md-medium text-text-primary">
            {t(($) => $['newKnowledge.guideTitle'])}
          </PopoverTitle>
          <PopoverDescription className="mt-2 system-sm-regular text-text-secondary">
            {t(($) => $['newKnowledge.guideDescription'])}
          </PopoverDescription>
          <div className="flex items-center justify-end gap-3 pt-3">
            <a
              href="https://docs.dify.ai/en/guides/knowledge-base"
              target="_blank"
              rel="noreferrer"
              className="rounded-sm system-xs-regular text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              {t(($) => $['newKnowledge.learnMore'])}
            </a>
            <Button variant="primary" size="small" onClick={dismissGuide}>
              {t(($) => $['newKnowledge.gotIt'])}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const KnowledgeFsList = () => {
  const [view, setView] = useQueryState('view', knowledgeViewParser)
  const viewSwitcher = (
    <KnowledgeViewSwitcher
      value={view}
      onChange={(nextView) => {
        void setView(nextView)
      }}
    />
  )

  if (view === 'new') return <NewKnowledgeList viewSwitcher={viewSwitcher} />

  return <LegacyList viewSwitcher={viewSwitcher} />
}

const List = () => {
  const { knowledge_fs_enabled: knowledgeFsEnabled } = useAtomValue(systemFeaturesAtom)

  if (!knowledgeFsEnabled) return <LegacyList />

  return <KnowledgeFsList />
}

export default List
