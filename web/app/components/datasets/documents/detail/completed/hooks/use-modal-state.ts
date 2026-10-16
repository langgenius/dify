import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import { useCallback, useRef, useState } from 'react'

type CurrSegmentType = {
  segInfo?: SegmentDetailModel
  showModal: boolean
  isEditMode?: boolean
}

type CurrChildChunkType = {
  childChunkInfo?: ChildChunkDetail
  showModal: boolean
}

type UseModalStateReturn = {
  currSegment: CurrSegmentType
  onClickCard: (detail: SegmentDetailModel, isEditMode?: boolean) => void
  onCloseSegmentDetail: () => void
  onCloseSegmentDetailIfCurrent: (expectedSegmentId: string) => void
  currChildChunk: CurrChildChunkType
  currChunkId: string
  onClickSlice: (detail: ChildChunkDetail) => void
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

  const initialCurrSegment: CurrSegmentType = { showModal: false }
  const [currSegment, setCurrSegment] = useState<CurrSegmentType>(initialCurrSegment)
  const currSegmentRef = useRef<CurrSegmentType>(initialCurrSegment)
  const [currChildChunk, setCurrChildChunk] = useState<CurrChildChunkType>({ showModal: false })
  const [currChunkId, setCurrChunkId] = useState('')
  const [showNewChildSegmentModal, setShowNewChildSegmentModal] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)

  const updateCurrSegment = useCallback((nextSegment: CurrSegmentType) => {
    currSegmentRef.current = nextSegment
    setCurrSegment(nextSegment)
  }, [])

  const onClickCard = useCallback(
    (detail: SegmentDetailModel, isEditMode = false) => {
      setCurrChildChunk({ showModal: false })
      updateCurrSegment({ segInfo: detail, showModal: true, isEditMode })
    },
    [updateCurrSegment],
  )

  const onCloseSegmentDetail = useCallback(() => {
    updateCurrSegment({ showModal: false })
    setFullScreen(false)
  }, [updateCurrSegment])

  const onCloseSegmentDetailIfCurrent = useCallback(
    (expectedSegmentId: string) => {
      if (currSegmentRef.current.segInfo?.id !== expectedSegmentId) return
      onCloseSegmentDetail()
    },
    [onCloseSegmentDetail],
  )

  const onClickSlice = useCallback(
    (detail: ChildChunkDetail) => {
      updateCurrSegment({ showModal: false })
      setCurrChildChunk({ childChunkInfo: detail, showModal: true })
      setCurrChunkId(detail.segment_id)
    },
    [updateCurrSegment],
  )

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
    onCloseSegmentDetailIfCurrent,
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
