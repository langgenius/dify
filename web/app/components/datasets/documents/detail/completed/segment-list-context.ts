import type {
  ChildChunkResponse,
  SegmentResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { noop } from 'es-toolkit/function'
import { createContext, useContextSelector } from 'use-context-selector'

type CurrSegmentType = {
  segInfo?: SegmentResponse
  showModal: boolean
  isEditMode?: boolean
}

type CurrChildChunkType = {
  childChunkInfo?: ChildChunkResponse
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
