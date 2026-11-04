import type {
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { useCallback, useState } from 'react'

type CurrSegmentType = {
  segInfo?: SegmentResponse
  showModal: boolean
  isEditMode?: boolean
}

type CurrChildChunkType = {
  childChunkInfo?: ChildChunkResponse
  showModal: boolean
}

type UseModalStateReturn = {
  currSegment: CurrSegmentType
  onClickCard: (detail: SegmentResponse, isEditMode?: boolean) => void
  onCloseSegmentDetail: () => void
  currChildChunk: CurrChildChunkType
  currChunkId: string
  onClickSlice: (detail: ChildChunkResponse) => void
  onCloseChildSegmentDetail: () => void
  onCloseNewSegmentModal: () => void
  showNewChildSegmentModal: boolean
  handleAddNewChildChunk: (parentChunkId: string) => void
  onCloseNewChildChunkModal: () => void
  fullScreen: boolean
  toggleFullScreen: () => void
  setFullScreen: (fullScreen: boolean) => void
  isCollapsed: boolean
  toggleCollapsed: () => void
}

type UseModalStateOptions = {
  onNewSegmentModalChange: (state: boolean) => void
}

export const useModalState = (options: UseModalStateOptions): UseModalStateReturn => {
  const { onNewSegmentModalChange } = options

  const [currSegment, setCurrSegment] = useState<CurrSegmentType>({ showModal: false })
  const [currChildChunk, setCurrChildChunk] = useState<CurrChildChunkType>({ showModal: false })
  const [currChunkId, setCurrChunkId] = useState('')
  const [showNewChildSegmentModal, setShowNewChildSegmentModal] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)

  const onClickCard = useCallback((detail: SegmentResponse, isEditMode = false) => {
    setCurrChildChunk({ showModal: false })
    setCurrSegment({ segInfo: detail, showModal: true, isEditMode })
  }, [])

  const onCloseSegmentDetail = useCallback(() => {
    setCurrSegment({ showModal: false })
    setFullScreen(false)
  }, [])

  const onClickSlice = useCallback((detail: ChildChunkResponse) => {
    setCurrSegment({ showModal: false })
    setCurrChildChunk({ childChunkInfo: detail, showModal: true })
    setCurrChunkId(detail.segment_id)
  }, [])

  const onCloseChildSegmentDetail = useCallback(() => {
    setCurrChildChunk({ showModal: false })
    setFullScreen(false)
  }, [])

  const onCloseNewSegmentModal = useCallback(() => {
    onNewSegmentModalChange(false)
    setFullScreen(false)
  }, [onNewSegmentModalChange])

  const handleAddNewChildChunk = useCallback((parentChunkId: string) => {
    setShowNewChildSegmentModal(true)
    setCurrChunkId(parentChunkId)
  }, [])

  const onCloseNewChildChunkModal = useCallback(() => {
    setShowNewChildSegmentModal(false)
    setFullScreen(false)
  }, [])

  const toggleFullScreen = useCallback(() => {
    setFullScreen((prev) => !prev)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => !prev)
  }, [])

  return {
    currSegment,
    onClickCard,
    onCloseSegmentDetail,
    currChildChunk,
    currChunkId,
    onClickSlice,
    onCloseChildSegmentDetail,
    onCloseNewSegmentModal,
    showNewChildSegmentModal,
    handleAddNewChildChunk,
    onCloseNewChildChunkModal,
    fullScreen,
    toggleFullScreen,
    setFullScreen,
    isCollapsed,
    toggleCollapsed,
  }
}
