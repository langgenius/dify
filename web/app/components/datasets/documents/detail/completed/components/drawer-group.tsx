'use client'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { ChildChunkDetail, ChunkingMode, SegmentDetailModel } from '@/models/datasets'
import NewSegment from '@/app/components/datasets/documents/detail/new-segment'
import ChildSegmentDetail from '../child-segment-detail'
import { DocumentDetailDrawer } from '../common/full-screen-drawer'
import NewChildSegment from '../new-child-segment'
import { SegmentDetail } from '../segment-detail'

type DrawerGroupProps = {
  currSegment: {
    segInfo?: SegmentDetailModel
    showModal: boolean
    isEditMode?: boolean
  }
  onCloseSegmentDetail: () => void
  onUpdateSegment: (
    segmentId: string,
    question: string,
    answer: string,
    keywords: string[],
    attachments: FileEntity[],
    summary?: string,
    needRegenerate?: boolean,
  ) => Promise<void>
  showNewSegmentModal: boolean
  onCloseNewSegmentModal: () => void
  onSaveNewSegment: () => void
  viewNewlyAddedChunk: () => void
  currChildChunk: {
    childChunkInfo?: ChildChunkDetail
    showModal: boolean
  }
  currChunkId: string
  onCloseChildSegmentDetail: () => void
  onUpdateChildChunk: (segmentId: string, childChunkId: string, content: string) => Promise<void>
  showNewChildSegmentModal: boolean
  onCloseNewChildChunkModal: () => void
  onSaveNewChildChunk: (newChildChunk?: ChildChunkDetail) => void
  viewNewlyAddedChildChunk: () => void
  fullScreen: boolean
  docForm: ChunkingMode
}

export function DrawerGroup({
  currSegment,
  onCloseSegmentDetail,
  onUpdateSegment,
  showNewSegmentModal,
  onCloseNewSegmentModal,
  onSaveNewSegment,
  viewNewlyAddedChunk,
  currChildChunk,
  currChunkId,
  onCloseChildSegmentDetail,
  onUpdateChildChunk,
  showNewChildSegmentModal,
  onCloseNewChildChunkModal,
  onSaveNewChildChunk,
  viewNewlyAddedChildChunk,
  fullScreen,
  docForm,
}: DrawerGroupProps) {
  return (
    <>
      <DocumentDetailDrawer
        open={currSegment.showModal}
        fullScreen={fullScreen}
        onClose={onCloseSegmentDetail}
      >
        <SegmentDetail
          key={currSegment.segInfo?.id}
          segInfo={currSegment.segInfo ?? { id: '' }}
          docForm={docForm}
          isEditMode={currSegment.isEditMode}
          onUpdate={onUpdateSegment}
          onCancel={onCloseSegmentDetail}
        />
      </DocumentDetailDrawer>

      <DocumentDetailDrawer
        open={showNewSegmentModal}
        fullScreen={fullScreen}
        onClose={onCloseNewSegmentModal}
        modal
      >
        <NewSegment
          docForm={docForm}
          onCancel={onCloseNewSegmentModal}
          onSave={onSaveNewSegment}
          viewNewlyAddedChunk={viewNewlyAddedChunk}
        />
      </DocumentDetailDrawer>

      <DocumentDetailDrawer
        open={currChildChunk.showModal}
        fullScreen={fullScreen}
        onClose={onCloseChildSegmentDetail}
      >
        <ChildSegmentDetail
          key={currChildChunk.childChunkInfo?.id}
          chunkId={currChunkId}
          childChunkInfo={currChildChunk.childChunkInfo ?? { id: '' }}
          docForm={docForm}
          onUpdate={onUpdateChildChunk}
          onCancel={onCloseChildSegmentDetail}
        />
      </DocumentDetailDrawer>

      <DocumentDetailDrawer
        open={showNewChildSegmentModal}
        fullScreen={fullScreen}
        onClose={onCloseNewChildChunkModal}
        modal
      >
        <NewChildSegment
          chunkId={currChunkId}
          onCancel={onCloseNewChildChunkModal}
          onSave={onSaveNewChildChunk}
          viewNewlyAddedChildChunk={viewNewlyAddedChildChunk}
        />
      </DocumentDetailDrawer>
    </>
  )
}
