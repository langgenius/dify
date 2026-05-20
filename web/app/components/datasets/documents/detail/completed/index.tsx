'use client'
import type { FC } from 'react'
import type { SegmentListContextValue } from './segment-list-context'
import type { SegmentImportStatus } from '@/types/dataset'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Pagination from '@/app/components/base/pagination'
import {
  useChunkListAllKey,
  useChunkListDisabledKey,
  useChunkListEnabledKey,
} from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import { useDocumentContext } from '../context'
import BatchAction from './common/batch-action'
import { DrawerGroup } from './components/drawer-group'
import MenuBar from './components/menu-bar'
import { FullDocModeContent, GeneralModeContent } from './components/segment-list-content'
import {
  mergeCurrentPageSelectedSegmentIds,
  useChildSegmentData,
  useModalState,
  useSearchFilter,
  useSegmentListData,
  useSegmentSelection,
} from './hooks'
import {
  SegmentListContext,
  useSegmentListContext,
} from './segment-list-context'

const DEFAULT_LIMIT = 10

type ICompletedProps = {
  embeddingAvailable: boolean
  showNewSegmentModal: boolean
  onNewSegmentModalChange: (state: boolean) => void
  importStatus: SegmentImportStatus | undefined
  archived?: boolean
}

/**
 * Embedding done, show list of all segments
 * Support search and filter
 */
const Completed: FC<ICompletedProps> = ({
  embeddingAvailable,
  showNewSegmentModal,
  onNewSegmentModalChange,
  importStatus,
  archived,
}) => {
  const { t } = useTranslation()
  const docForm = useDocumentContext(s => s.docForm)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [limit, setLimit] = useState(DEFAULT_LIMIT)

  // Search and filter state
  const searchFilter = useSearchFilter({
    onPageChange: setCurrentPage,
  })

  // Modal state
  const modalState = useModalState({
    onNewSegmentModalChange,
  })

  // Selection state
  const selectionState = useSegmentSelection()

  // Invalidation hooks for child segment data
  const invalidChunkListAll = useInvalid(useChunkListAllKey)
  const invalidChunkListEnabled = useInvalid(useChunkListEnabledKey)
  const invalidChunkListDisabled = useInvalid(useChunkListDisabledKey)

  const refreshChunkListDataWithDetailChanged = useCallback(() => {
    const refreshMap: Record<string, () => void> = {
      all: () => {
        invalidChunkListDisabled()
        invalidChunkListEnabled()
      },
      true: () => {
        invalidChunkListAll()
        invalidChunkListDisabled()
      },
      false: () => {
        invalidChunkListAll()
        invalidChunkListEnabled()
      },
    }
    refreshMap[String(searchFilter.selectedStatus)]?.()
  }, [searchFilter.selectedStatus, invalidChunkListDisabled, invalidChunkListEnabled, invalidChunkListAll])

  // Segment list data
  const segmentListDataHook = useSegmentListData({
    searchValue: searchFilter.searchValue,
    selectedStatus: searchFilter.selectedStatus,
    selectedSegmentIds: selectionState.selectedSegmentIds,
    importStatus,
    currentPage,
    limit,
    onCloseSegmentDetail: modalState.onCloseSegmentDetail,
    clearSelection: selectionState.clearSelection,
  })

  const segmentIds = useMemo(
    () => segmentListDataHook.segments.map(segment => segment.id),
    [segmentListDataHook.segments],
  )
  const currentPageSegmentIdSet = useMemo(() => new Set(segmentIds), [segmentIds])
  const currentPageSelectedSegmentIds = useMemo(() => {
    return selectionState.selectedSegmentIds.filter(segmentId => currentPageSegmentIdSet.has(segmentId))
  }, [currentPageSegmentIdSet, selectionState.selectedSegmentIds])
  const handleCurrentPageSelectedSegmentIdsChange = useCallback((nextCurrentPageSelectedSegmentIds: string[]) => {
    selectionState.onSelectedSegmentIdsChange(mergeCurrentPageSelectedSegmentIds({
      selectedSegmentIds: selectionState.selectedSegmentIds,
      currentPageSegmentIds: segmentIds,
      nextCurrentPageSelectedSegmentIds,
    }))
  }, [segmentIds, selectionState.selectedSegmentIds, selectionState.onSelectedSegmentIdsChange])

  // Child segment data
  const childSegmentDataHook = useChildSegmentData({
    searchValue: searchFilter.searchValue,
    currentPage,
    limit,
    segments: segmentListDataHook.segments,
    currChunkId: modalState.currChunkId,
    isFullDocMode: segmentListDataHook.isFullDocMode,
    onCloseChildSegmentDetail: modalState.onCloseChildSegmentDetail,
    refreshChunkListDataWithDetailChanged,
    updateSegmentInCache: segmentListDataHook.updateSegmentInCache,
  })

  // Compute total for pagination
  const paginationTotal = useMemo(() => {
    if (segmentListDataHook.isFullDocMode)
      return childSegmentDataHook.childChunkListData?.total || 0
    return segmentListDataHook.segmentListData?.total || 0
  }, [segmentListDataHook.isFullDocMode, childSegmentDataHook.childChunkListData, segmentListDataHook.segmentListData])

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page + 1)
  }, [])

  // Context value
  const contextValue = useMemo<SegmentListContextValue>(() => ({
    isCollapsed: modalState.isCollapsed,
    fullScreen: modalState.fullScreen,
    toggleFullScreen: modalState.toggleFullScreen,
    currSegment: modalState.currSegment,
    currChildChunk: modalState.currChildChunk,
  }), [
    modalState.isCollapsed,
    modalState.fullScreen,
    modalState.toggleFullScreen,
    modalState.currSegment,
    modalState.currChildChunk,
  ])

  return (
    <SegmentListContext.Provider value={contextValue}>
      {/* Segment list */}
      {segmentListDataHook.isFullDocMode
        ? (
            <FullDocModeContent
              segments={segmentListDataHook.segments}
              childSegments={childSegmentDataHook.childSegments}
              isLoadingSegmentList={segmentListDataHook.isLoadingSegmentList}
              isLoadingChildSegmentList={childSegmentDataHook.isLoadingChildSegmentList}
              currSegmentId={modalState.currSegment?.segInfo?.id}
              onClickCard={modalState.onClickCard}
              onDeleteChildChunk={childSegmentDataHook.onDeleteChildChunk}
              handleInputChange={searchFilter.handleInputChange}
              handleAddNewChildChunk={modalState.handleAddNewChildChunk}
              onClickSlice={modalState.onClickSlice}
              archived={archived}
              childChunkTotal={childSegmentDataHook.childChunkListData?.total || 0}
              inputValue={searchFilter.inputValue}
              onClearFilter={searchFilter.onClearFilter}
            />
          )
        : (
            <CheckboxGroup
              aria-label={t('segment.chunk', { ns: 'datasetDocuments' })}
              value={currentPageSelectedSegmentIds}
              onValueChange={nextSegmentIds => handleCurrentPageSelectedSegmentIdsChange(nextSegmentIds)}
              allValues={segmentIds}
              className="flex min-h-0 grow flex-col"
            >
              <MenuBar
                hasSelectableSegments={segmentIds.length > 0}
                isLoading={segmentListDataHook.isLoadingSegmentList}
                totalText={segmentListDataHook.totalText}
                statusList={searchFilter.statusList}
                selectDefaultValue={searchFilter.selectDefaultValue}
                onChangeStatus={searchFilter.onChangeStatus}
                inputValue={searchFilter.inputValue}
                onInputChange={searchFilter.handleInputChange}
                isCollapsed={modalState.isCollapsed}
                toggleCollapsed={modalState.toggleCollapsed}
              />
              <GeneralModeContent
                segmentListRef={segmentListDataHook.segmentListRef}
                embeddingAvailable={embeddingAvailable}
                isLoadingSegmentList={segmentListDataHook.isLoadingSegmentList}
                segments={segmentListDataHook.segments}
                onChangeSwitch={segmentListDataHook.onChangeSwitch}
                onDelete={segmentListDataHook.onDelete}
                onClickCard={modalState.onClickCard}
                archived={archived}
                onDeleteChildChunk={childSegmentDataHook.onDeleteChildChunk}
                handleAddNewChildChunk={modalState.handleAddNewChildChunk}
                onClickSlice={modalState.onClickSlice}
                onClearFilter={searchFilter.onClearFilter}
              />
            </CheckboxGroup>
          )}

      {/* Pagination */}
      <Divider type="horizontal" className="mx-6 my-0 h-px w-auto bg-divider-subtle" />
      <Pagination
        current={currentPage - 1}
        onChange={handlePageChange}
        total={paginationTotal}
        limit={limit}
        onLimitChange={setLimit}
        className={segmentListDataHook.isFullDocMode ? 'px-3' : ''}
      />

      {/* Drawer Group - only render when docForm is available */}
      {docForm && (
        <DrawerGroup
          currSegment={modalState.currSegment}
          onCloseSegmentDetail={modalState.onCloseSegmentDetail}
          onUpdateSegment={segmentListDataHook.handleUpdateSegment}
          showNewSegmentModal={showNewSegmentModal}
          onCloseNewSegmentModal={modalState.onCloseNewSegmentModal}
          onSaveNewSegment={segmentListDataHook.resetList}
          viewNewlyAddedChunk={segmentListDataHook.viewNewlyAddedChunk}
          currChildChunk={modalState.currChildChunk}
          currChunkId={modalState.currChunkId}
          onCloseChildSegmentDetail={modalState.onCloseChildSegmentDetail}
          onUpdateChildChunk={childSegmentDataHook.handleUpdateChildChunk}
          showNewChildSegmentModal={modalState.showNewChildSegmentModal}
          onCloseNewChildChunkModal={modalState.onCloseNewChildChunkModal}
          onSaveNewChildChunk={childSegmentDataHook.onSaveNewChildChunk}
          viewNewlyAddedChildChunk={childSegmentDataHook.viewNewlyAddedChildChunk}
          fullScreen={modalState.fullScreen}
          docForm={docForm}
        />
      )}

      {/* Batch Action Buttons */}
      {selectionState.selectedSegmentIds.length > 0 && (
        <BatchAction
          className="absolute bottom-16 left-0 z-20"
          selectedIds={selectionState.selectedSegmentIds}
          onBatchEnable={() => segmentListDataHook.onChangeSwitch(true, '')}
          onBatchDisable={() => segmentListDataHook.onChangeSwitch(false, '')}
          onBatchDelete={() => segmentListDataHook.onDelete('')}
          onCancel={selectionState.onCancelBatchOperation}
        />
      )}
    </SegmentListContext.Provider>
  )
}

export { useSegmentListContext }
export type { SegmentListContextValue }

export default Completed
