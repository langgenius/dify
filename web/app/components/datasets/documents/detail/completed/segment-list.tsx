import React, { type ForwardedRef } from 'react'
import SegmentCard from './segment-card'
import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import Checkbox from '@/app/components/base/checkbox'
import Loading from '@/app/components/base/loading'
import Divider from '@/app/components/base/divider'
import classNames from '@/utils/classnames'

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
}: ISegmentListProps,
ref: ForwardedRef<HTMLDivElement>,
) => {
  if (isLoading)
    return <Loading type='app' />
  return (
    <div ref={ref} className={classNames('flex flex-col h-full overflow-y-auto')}>
      {
        items.map((segItem) => {
          const isLast = items[items.length - 1].id === segItem.id
          return (
            <div key={segItem.id} className='flex items-start gap-x-2'>
              <Checkbox
                key={`${segItem.id}-checkbox`}
                className='shrink-0 mt-3.5'
                checked={selectedSegmentIds.includes(segItem.id)}
                onCheck={() => onSelected(segItem.id)}
              />
              <div className='grow'>
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
