'use client'
import type { FC } from 'react'
import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { ChildChunkDetail, ChunkingMode, SegmentDetailModel } from '@/models/datasets'
import NewSegment from '@/app/components/datasets/documents/detail/new-segment'
import ChildSegmentDetail from '../child-segment-detail'
import FullScreenDrawer from '../common/full-screen-drawer'
import NewChildSegment from '../new-child-segment'
import SegmentDetail from '../segment-detail'

type DrawerGroupProps = {
  // Segment detail drawer
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
  isRegenerationModalOpen: boolean
  setIsRegenerationModalOpen: (open: boolean) => void
  // New segment drawer
  showNewSegmentModal: boolean
  onCloseNewSegmentModal: () => void
  onSaveNewSegment: () => void
  viewNewlyAddedChunk: () => void
  // Child segment detail drawer
  currChildChunk: {
    childChunkInfo?: ChildChunkDetail
    showModal: boolean
  }
  currChunkId: string
  onCloseChildSegmentDetail: () => void
  onUpdateChildChunk: (segmentId: string, childChunkId: string, content: string) => Promise<void>
  // New child segment drawer
  showNewChildSegmentModal: boolean
  onCloseNewChildChunkModal: () => void
  onSaveNewChildChunk: (newChildChunk?: ChildChunkDetail) => void
  viewNewlyAddedChildChunk: () => void
  // Common props
  fullScreen: boolean
  docForm: ChunkingMode
}

const DrawerGroup: FC<DrawerGroupProps> = ({
  // Segment detail drawer
  currSegment,
  onCloseSegmentDetail,
  onUpdateSegment,
  isRegenerationModalOpen,
  setIsRegenerationModalOpen,
  // New segment drawer
  showNewSegmentModal,
  onCloseNewSegmentModal,
  onSaveNewSegment,
  viewNewlyAddedChunk,
  // Child segment detail drawer
  currChildChunk,
  currChunkId,
  onCloseChildSegmentDetail,
  onUpdateChildChunk,
  // New child segment drawer
  showNewChildSegmentModal,
  onCloseNewChildChunkModal,
  onSaveNewChildChunk,
  viewNewlyAddedChildChunk,
  // Common props
  fullScreen,
  docForm,
}) => {
  return (
    <>
      {/* Edit or view segment detail */}
      <FullScreenDrawer
        isOpen={currSegment.showModal}
        fullScreen={fullScreen}
        onClose={onCloseSegmentDetail}
        showOverlay={false}
        needCheckChunks
        modal={isRegenerationModalOpen}
      >
        <SegmentDetail
          key={currSegment.segInfo?.id}
          segInfo={currSegment.segInfo ?? { id: '' }}
          docForm={docForm}
          isEditMode={currSegment.isEditMode}
          onUpdate={onUpdateSegment}
          onCancel={onCloseSegmentDetail}
          onModalStateChange={setIsRegenerationModalOpen}
        />
      </FullScreenDrawer>

      {/* Create New Segment */}
      <FullScreenDrawer
        isOpen={showNewSegmentModal}
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
      </FullScreenDrawer>

      {/* Edit or view child segment detail */}
      <FullScreenDrawer
        isOpen={currChildChunk.showModal}
        fullScreen={fullScreen}
        onClose={onCloseChildSegmentDetail}
        showOverlay={false}
        needCheckChunks
      >
        <ChildSegmentDetail
          key={currChildChunk.childChunkInfo?.id}
          chunkId={currChunkId}
          childChunkInfo={currChildChunk.childChunkInfo ?? { id: '' }}
          docForm={docForm}
          onUpdate={onUpdateChildChunk}
          onCancel={onCloseChildSegmentDetail}
        />
      </FullScreenDrawer>

      {/* Create New Child Segment */}
      <FullScreenDrawer
        isOpen={showNewChildSegmentModal}
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
      </FullScreenDrawer>
    </>
  )
}

export default DrawerGroup
