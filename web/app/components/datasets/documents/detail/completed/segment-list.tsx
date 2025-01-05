import React, { type ForwardedRef, useMemo } from 'react'
import { useDocumentContext } from '../index'
import SegmentCard from './segment-card'
import Empty from './common/empty'
import GeneralListSkeleton from './skeleton/general-list-skeleton'
import ParagraphListSkeleton from './skeleton/paragraph-list-skeleton'
import { useSegmentListContext } from './index'
import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'

type ISegmentListProps = {
  isLoading: boolean
  items: SegmentDetailModel[]
  selectedSegmentIds: string[]
  onSelected: (segId: string) => void
  onClick: (detail: SegmentDetailModel, isEditMode?: boolean) => void
  onChangeSwitch: (enabled: boolean, segId?: string,) => Promise<void>
  onDelete: (segId: string) => Promise<void>
  onDeleteChildChunk: (sgId: string, childChunkId: string) => Promise<void>
  handleAddNewChildChunk: (parentChunkId: string) => void
  onClickSlice: (childChunk: ChildChunkDetail) => void
  archived?: boolean
  embeddingAvailable: boolean
  onClearFilter: () => void
}

const SegmentList = React.forwardRef(({
  isLoading,
  items,
  selectedSegmentIds,
  onSelected,
  onClick: onClickCard,
  onChangeSwitch,
  onDelete,
  onDeleteChildChunk,
  handleAddNewChildChunk,
  onClickSlice,
  archived,
  embeddingAvailable,
  onClearFilter,
}: ISegmentListProps,
ref: ForwardedRef<HTMLDivElement>,
) => {
  const mode = useDocumentContext(s => s.mode)
  const parentMode = useDocumentContext(s => s.parentMode)
  const currSegment = useSegmentListContext(s => s.currSegment)
  const currChildChunk = useSegmentListContext(s => s.currChildChunk)

  const Skeleton = useMemo(() => {
    return (mode === 'hierarchical' && parentMode === 'paragraph') ? ParagraphListSkeleton : GeneralListSkeleton
  }, [mode, parentMode])

  // Loading skeleton
  if (isLoading)
    return <Skeleton />
  // Search result is empty
  if (items.length === 0) {
    return (
      <div className='h-full pl-6'>
        <Empty onClearFilter={onClearFilter} />
      </div>
    )
  }
  return (
    <div ref={ref} className={'flex flex-col grow overflow-y-auto'}>
      {
        items.map((segItem) => {
          const isLast = items[items.length - 1].id === segItem.id
          const segmentIndexFocused
            = currSegment?.segInfo?.id === segItem.id
            || (!currSegment && currChildChunk?.childChunkInfo?.segment_id === segItem.id)
          const segmentContentFocused = currSegment?.segInfo?.id === segItem.id
            || currChildChunk?.childChunkInfo?.segment_id === segItem.id
          return (
            <div key={segItem.id} className='flex items-start gap-x-2'>
              <Checkbox
                key={`${segItem.id}-checkbox`}
                className='shrink-0 mt-3.5'
                checked={selectedSegmentIds.includes(segItem.id)}
                onCheck={() => onSelected(segItem.id)}
              />
              <div className='grow min-w-0'>
                <SegmentCard
                  key={`${segItem.id}-card`}
                  detail={segItem}
                  onClick={() => onClickCard(segItem, true)}
                  onChangeSwitch={onChangeSwitch}
                  onClickEdit={() => onClickCard(segItem, true)}
                  onDelete={onDelete}
                  onDeleteChildChunk={onDeleteChildChunk}
                  handleAddNewChildChunk={handleAddNewChildChunk}
                  onClickSlice={onClickSlice}
                  loading={false}
                  archived={archived}
                  embeddingAvailable={embeddingAvailable}
                  focused={{
                    segmentIndex: segmentIndexFocused,
                    segmentContent: segmentContentFocused,
                  }}
                />
                {!isLast && <div className='w-full px-3'>
                  <Divider type='horizontal' className='bg-divider-subtle my-1' />
                </div>}
              </div>
            </div>
          )
        })
      }
    </div>
  )
})

SegmentList.displayName = 'SegmentList'

export default SegmentList
