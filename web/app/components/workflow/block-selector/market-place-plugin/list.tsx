'use client'
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useStickyScroll, { ScrollPosition } from '../use-sticky-scroll'
import Item from './item'
import type { Plugin } from '@/app/components/plugins/types.ts'
import cn from '@/utils/classnames'
// import { RiArrowRightUpLine } from '@remixicon/react'

type Props = {
  wrapElemRef: React.RefObject<HTMLElement>
  list: Plugin[]
}

const List = ({
  wrapElemRef,
  list,
}: Props, ref: any) => {
  const { t } = useTranslation()
  const nextToStickyELemRef = useRef<HTMLDivElement>(null)

  const { handleScroll, scrollPosition } = useStickyScroll({
    wrapElemRef,
    nextToStickyELemRef,
  })

  const stickyClassName = useMemo(() => {
    switch (scrollPosition) {
      case ScrollPosition.aboveTheWrap:
        return 'top-0 h-9 pt-3 pb-2 shadow-xs bg-components-panel-bg-blur'
      case ScrollPosition.showing:
        return 'bottom-0 pt-3 pb-1'
      case ScrollPosition.belowTheWrap:
        return 'bottom-0 items-center rounded-b-xl border-t border-[0.5px] border-components-panel-border bg-components-panel-bg-blur text-blue-500 shadow-lg text-text-accent-light-mode-only cursor-pointer'
    }
  }, [scrollPosition])

  useImperativeHandle(ref, () => ({
    handleScroll,
  }))

  const scrollToView = () => {
    if (scrollPosition !== ScrollPosition.belowTheWrap)
      return

    nextToStickyELemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <div
        className={cn('sticky z-10 flex h-8 px-4 py-1 text-text-primary system-sm-medium', stickyClassName)}
        onClick={scrollToView}
      >
        <span>{t('plugin.fromMarketplace')}</span>
        {/* {scrollPosition === ScrollPosition.belowTheWrap && (
          <RiArrowRightUpLine className='ml-0.5 w-3 h-3' />
        )} */}
      </div>
      <div className='p-1' ref={nextToStickyELemRef}>
        {list.map((item, index) => (
          <Item
            key={index}
            payload={item}
            onAction={() => { }}
          />
        ))}
      </div>
    </>
  )
}
export default forwardRef(List)
