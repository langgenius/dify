'use client'
import type { FC } from 'react'
import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import ChildSegmentList from '../child-segment-list'
import SegmentCard from '../segment-card'
import SegmentList from '../segment-list'

type FullDocModeContentProps = {
  segments: SegmentDetailModel[]
  childSegments: ChildChunkDetail[]
  isLoadingSegmentList: boolean
  isLoadingChildSegmentList: boolean
  currSegmentId?: string
  onClickCard: (detail: SegmentDetailModel, isEditMode?: boolean) => void
  onDeleteChildChunk: (segmentId: string, childChunkId: string) => Promise<void>
  handleInputChange: (value: string) => void
  handleAddNewChildChunk: (parentChunkId: string) => void
  onClickSlice: (detail: ChildChunkDetail) => void
  archived?: boolean
  childChunkTotal: number
  inputValue: string
  onClearFilter: () => void
}

export const FullDocModeContent: FC<FullDocModeContentProps> = ({
  segments,
  childSegments,
  isLoadingSegmentList,
  isLoadingChildSegmentList,
  currSegmentId,
  onClickCard,
  onDeleteChildChunk,
  handleInputChange,
  handleAddNewChildChunk,
  onClickSlice,
  archived,
  childChunkTotal,
  inputValue,
  onClearFilter,
}) => {
  const firstSegment = segments[0]

  return (
    <div className={cn(
      'flex grow flex-col overflow-x-hidden',
      (isLoadingSegmentList || isLoadingChildSegmentList) ? 'overflow-y-hidden' : 'overflow-y-auto',
    )}
    >
      <SegmentCard
        detail={firstSegment}
        onClick={() => onClickCard(firstSegment)}
        loading={isLoadingSegmentList}
        focused={{
          segmentIndex: currSegmentId === firstSegment?.id,
          segmentContent: currSegmentId === firstSegment?.id,
        }}
      />
      <ChildSegmentList
        parentChunkId={firstSegment?.id}
        onDelete={onDeleteChildChunk}
        childChunks={childSegments}
        handleInputChange={handleInputChange}
        handleAddNewChildChunk={handleAddNewChildChunk}
        onClickSlice={onClickSlice}
        enabled={!archived}
        total={childChunkTotal}
        inputValue={inputValue}
        onClearFilter={onClearFilter}
        isLoading={isLoadingSegmentList || isLoadingChildSegmentList}
      />
    </div>
  )
}

type GeneralModeContentProps = {
  segmentListRef: React.RefObject<HTMLDivElement | null>
  embeddingAvailable: boolean
  isLoadingSegmentList: boolean
  segments: SegmentDetailModel[]
  selectedSegmentIds: string[]
  onSelected: (segId: string) => void
  onChangeSwitch: (enable: boolean, segId?: string) => Promise<void>
  onDelete: (segId?: string) => Promise<void>
  onClickCard: (detail: SegmentDetailModel, isEditMode?: boolean) => void
  archived?: boolean
  onDeleteChildChunk: (segmentId: string, childChunkId: string) => Promise<void>
  handleAddNewChildChunk: (parentChunkId: string) => void
  onClickSlice: (detail: ChildChunkDetail) => void
  onClearFilter: () => void
}

export const GeneralModeContent: FC<GeneralModeContentProps> = ({
  segmentListRef,
  embeddingAvailable,
  isLoadingSegmentList,
  segments,
  selectedSegmentIds,
  onSelected,
  onChangeSwitch,
  onDelete,
  onClickCard,
  archived,
  onDeleteChildChunk,
  handleAddNewChildChunk,
  onClickSlice,
  onClearFilter,
}) => {
  return (
    <SegmentList
      ref={segmentListRef}
      embeddingAvailable={embeddingAvailable}
      isLoading={isLoadingSegmentList}
      items={segments}
      selectedSegmentIds={selectedSegmentIds}
      onSelected={onSelected}
      onChangeSwitch={onChangeSwitch}
      onDelete={onDelete}
      onClick={onClickCard}
      archived={archived}
      onDeleteChildChunk={onDeleteChildChunk}
      handleAddNewChildChunk={handleAddNewChildChunk}
      onClickSlice={onClickSlice}
      onClearFilter={onClearFilter}
    />
  )
}
