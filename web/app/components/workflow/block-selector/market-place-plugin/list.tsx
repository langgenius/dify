'use client'
import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useStickyScroll, { ScrollPosition } from '../use-sticky-scroll'
import Item from './item'
import type { Plugin } from '@/app/components/plugins/types.ts'
import cn from '@/utils/classnames'

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
        return 'top-0 shadow-md bg-white'
      case ScrollPosition.showing:
        return 'bottom-0'
      case ScrollPosition.belowTheWrap:
        return 'bottom-0 border-t border-gray-500 bg-white text-blue-500'
    }
  }, [scrollPosition])

  useImperativeHandle(ref, () => ({
    handleScroll,
  }))

  return (
    <>
      <div
        className={cn('sticky z-10 pt-3 px-4 py-1 text-text-primary system-sm-medium', stickyClassName)}>
        {t('plugin.fromMarketplace')}
      </div>
      <div className='p-1 pb-[500px]' ref={nextToStickyELemRef}>
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
