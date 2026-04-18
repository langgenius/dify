import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { SegmentListContext, useSegmentListContext } from '../segment-list-context'

describe('SegmentListContext', () => {
  it('should expose the default collapsed state', () => {
    const { result } = renderHook(() => useSegmentListContext(value => value))

    expect(result.current).toEqual({
      isCollapsed: true,
      fullScreen: false,
      toggleFullScreen: expect.any(Function),
      currSegment: { showModal: false },
      currChildChunk: { showModal: false },
    })
  })

  it('should select provider values from the current segment list context', () => {
    const toggleFullScreen = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SegmentListContext.Provider value={{
        isCollapsed: false,
        fullScreen: true,
        toggleFullScreen,
        currSegment: {
          showModal: true,
          isEditMode: true,
          segInfo: { id: 'segment-1' } as never,
        },
        currChildChunk: {
          showModal: true,
          childChunkInfo: { id: 'child-1' } as never,
        },
      }}
      >
        {children}
      </SegmentListContext.Provider>
    )

    const { result } = renderHook(
      () => useSegmentListContext(value => ({
        fullScreen: value.fullScreen,
        segmentOpen: value.currSegment.showModal,
        childOpen: value.currChildChunk.showModal,
      })),
      { wrapper },
    )

    expect(result.current).toEqual({
      fullScreen: true,
      segmentOpen: true,
      childOpen: true,
    })
  })
})
