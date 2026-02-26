import type { ChildChunkDetail, SegmentDetailModel } from '@/models/datasets'
import { noop } from 'es-toolkit/function'
import { createContext, useContextSelector } from 'use-context-selector'

export type CurrSegmentType = {
  segInfo?: SegmentDetailModel
  showModal: boolean
  isEditMode?: boolean
}

export type CurrChildChunkType = {
  childChunkInfo?: ChildChunkDetail
  showModal: boolean
}

export type SegmentListContextValue = {
  isCollapsed: boolean
  fullScreen: boolean
  toggleFullScreen: () => void
  currSegment: CurrSegmentType
  currChildChunk: CurrChildChunkType
}

export const SegmentListContext = createContext<SegmentListContextValue>({
  isCollapsed: true,
  fullScreen: false,
  toggleFullScreen: noop,
  currSegment: { showModal: false },
  currChildChunk: { showModal: false },
})

export const useSegmentListContext = <T>(selector: (value: SegmentListContextValue) => T): T => {
  return useContextSelector(SegmentListContext, selector)
}
