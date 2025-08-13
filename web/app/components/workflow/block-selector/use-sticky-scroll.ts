import React from 'react'
import { useThrottleFn } from 'ahooks'

export enum ScrollPosition {
  belowTheWrap = 'belowTheWrap',
  showing = 'showing',
  aboveTheWrap = 'aboveTheWrap',
}

type Params = {
  wrapElemRef: React.RefObject<HTMLElement | null>
  nextToStickyELemRef: React.RefObject<HTMLElement | null>
}
const useStickyScroll = ({
  wrapElemRef,
  nextToStickyELemRef,
}: Params) => {
  const [scrollPosition, setScrollPosition] = React.useState<ScrollPosition>(ScrollPosition.belowTheWrap)
  const { run: handleScroll } = useThrottleFn(() => {
    const wrapDom = wrapElemRef.current
    const stickyDOM = nextToStickyELemRef.current
    if (!wrapDom || !stickyDOM)
      return
    const { height: wrapHeight, top: wrapTop } = wrapDom.getBoundingClientRect()
    const { top: nextToStickyTop } = stickyDOM.getBoundingClientRect()
    let scrollPositionNew: ScrollPosition

    if (nextToStickyTop - wrapTop >= wrapHeight)
      scrollPositionNew = ScrollPosition.belowTheWrap
    else if (nextToStickyTop <= wrapTop)
      scrollPositionNew = ScrollPosition.aboveTheWrap
    else
      scrollPositionNew = ScrollPosition.showing

    if (scrollPosition !== scrollPositionNew)
      setScrollPosition(scrollPositionNew)
  }, { wait: 100 })

  return {
    handleScroll,
    scrollPosition,
  }
}

export default useStickyScroll
