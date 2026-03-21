import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import { useCallback, useState } from 'react'

export type CurrSegmentType = {
  segInfo?: SegmentDetailModel
  showModal: boolean
  isEditMode?: boolean
}

export type CurrChildChunkType = {
  childChunkInfo?: ChildChunkDetail
  showModal: boolean
}

export type UseModalStateReturn = {
  // Segment detail modal
  currSegment: CurrSegmentType
  onClickCard: (detail: SegmentDetailModel, isEditMode?: boolean) => void
  onCloseSegmentDetail: () => void
  // Child segment detail modal
  currChildChunk: CurrChildChunkType
  currChunkId: string
  onClickSlice: (detail: ChildChunkDetail) => void
  onCloseChildSegmentDetail: () => void
  // New segment modal
  onCloseNewSegmentModal: () => void
  // New child segment modal
  showNewChildSegmentModal: boolean
  handleAddNewChildChunk: (parentChunkId: string) => void
  onCloseNewChildChunkModal: () => void
  // Regeneration modal
  isRegenerationModalOpen: boolean
  setIsRegenerationModalOpen: (open: boolean) => void
  // Full screen
  fullScreen: boolean
  toggleFullScreen: () => void
  setFullScreen: (fullScreen: boolean) => void
  // Collapsed state
  isCollapsed: boolean
  toggleCollapsed: () => void
}

type UseModalStateOptions = {
  onNewSegmentModalChange: (state: boolean) => void
}

export const useModalState = (options: UseModalStateOptions): UseModalStateReturn => {
  const { onNewSegmentModalChange } = options

  // Segment detail modal state
  const [currSegment, setCurrSegment] = useState<CurrSegmentType>({ showModal: false })

  // Child segment detail modal state
  const [currChildChunk, setCurrChildChunk] = useState<CurrChildChunkType>({ showModal: false })
  const [currChunkId, setCurrChunkId] = useState('')

  // New child segment modal state
  const [showNewChildSegmentModal, setShowNewChildSegmentModal] = useState(false)

  // Regeneration modal state
  const [isRegenerationModalOpen, setIsRegenerationModalOpen] = useState(false)

  // Display state
  const [fullScreen, setFullScreen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)

  // Segment detail handlers
  const onClickCard = useCallback((detail: SegmentDetailModel, isEditMode = false) => {
    setCurrSegment({ segInfo: detail, showModal: true, isEditMode })
  }, [])

  const onCloseSegmentDetail = useCallback(() => {
    setCurrSegment({ showModal: false })
    setFullScreen(false)
  }, [])

  // Child segment detail handlers
  const onClickSlice = useCallback((detail: ChildChunkDetail) => {
    setCurrChildChunk({ childChunkInfo: detail, showModal: true })
    setCurrChunkId(detail.segment_id)
  }, [])

  const onCloseChildSegmentDetail = useCallback(() => {
    setCurrChildChunk({ showModal: false })
    setFullScreen(false)
  }, [])

  // New segment modal handlers
  const onCloseNewSegmentModal = useCallback(() => {
    onNewSegmentModalChange(false)
    setFullScreen(false)
  }, [onNewSegmentModalChange])

  // New child segment modal handlers
  const handleAddNewChildChunk = useCallback((parentChunkId: string) => {
    setShowNewChildSegmentModal(true)
    setCurrChunkId(parentChunkId)
  }, [])

  const onCloseNewChildChunkModal = useCallback(() => {
    setShowNewChildSegmentModal(false)
    setFullScreen(false)
  }, [])

  // Display handlers - handles both direct calls and click events
  const toggleFullScreen = useCallback(() => {
    setFullScreen(prev => !prev)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev)
  }, [])

  return {
    // Segment detail modal
    currSegment,
    onClickCard,
    onCloseSegmentDetail,
    // Child segment detail modal
    currChildChunk,
    currChunkId,
    onClickSlice,
    onCloseChildSegmentDetail,
    // New segment modal
    onCloseNewSegmentModal,
    // New child segment modal
    showNewChildSegmentModal,
    handleAddNewChildChunk,
    onCloseNewChildChunkModal,
    // Regeneration modal
    isRegenerationModalOpen,
    setIsRegenerationModalOpen,
    // Full screen
    fullScreen,
    toggleFullScreen,
    setFullScreen,
    // Collapsed state
    isCollapsed,
    toggleCollapsed,
  }
}
