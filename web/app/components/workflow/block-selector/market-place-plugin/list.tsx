'use client'
import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useStickyScroll, { ScrollPosition } from '../use-sticky-scroll'
import Item from './item'
import type { Plugin } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'
import Link from 'next/link'
import { RiArrowRightUpLine, RiSearchLine } from '@remixicon/react'
import { noop } from 'lodash-es'
import { getMarketplaceUrl } from '@/utils/var'

export type ListProps = {
  wrapElemRef: React.RefObject<HTMLElement | null>
  list: Plugin[]
  searchText: string
  tags: string[]
  toolContentClassName?: string
  disableMaxWidth?: boolean
  ref?: React.Ref<ListRef>
}

export type ListRef = { handleScroll: () => void }

const List = ({
  wrapElemRef,
  searchText,
  tags,
  list,
  toolContentClassName,
  disableMaxWidth = false,
  ref,
}: ListProps) => {
  const { t } = useTranslation()
  const noFilter = !searchText && tags.length === 0
  const hasRes = list.length > 0
  const urlWithSearchText = getMarketplaceUrl('', { q: searchText, tags: tags.join(',') })
  const nextToStickyELemRef = useRef<HTMLDivElement>(null)

  const { handleScroll, scrollPosition } = useStickyScroll({
    wrapElemRef,
    nextToStickyELemRef,
  })
  const stickyClassName = useMemo(() => {
    switch (scrollPosition) {
      case ScrollPosition.aboveTheWrap:
        return 'top-0 h-9 pt-3 pb-2 shadow-xs bg-components-panel-bg-blur cursor-pointer'
      case ScrollPosition.showing:
        return 'bottom-0 pt-3 pb-1'
      case ScrollPosition.belowTheWrap:
        return 'bottom-0 items-center rounded-b-xl border-t border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg rounded-b-lg cursor-pointer'
    }
  }, [scrollPosition])

  useImperativeHandle(ref, () => ({
    handleScroll,
  }))

  useEffect(() => {
    handleScroll()
  }, [list])

  const handleHeadClick = () => {
    if (scrollPosition === ScrollPosition.belowTheWrap) {
      nextToStickyELemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    window.open(urlWithSearchText, '_blank')
  }

  if (noFilter) {
    return (
      <Link
        className='system-sm-medium sticky bottom-0 z-10 flex h-8 cursor-pointer items-center rounded-b-lg border-[0.5px] border-t border-components-panel-border bg-components-panel-bg-blur px-4 py-1 text-text-accent-light-mode-only shadow-lg'
        href={getMarketplaceUrl('')}
        target='_blank'
      >
        <span>{t('plugin.findMoreInMarketplace')}</span>
        <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
      </Link>
    )
  }

  const maxWidthClassName = toolContentClassName || 'max-w-[100%]'

  return (
    <>
      {hasRes && (
        <div
          className={cn('system-sm-medium sticky z-10 flex h-8 cursor-pointer justify-between px-4 py-1 text-text-primary', stickyClassName, !disableMaxWidth && maxWidthClassName)}
          onClick={handleHeadClick}
        >
          <span>{t('plugin.fromMarketplace')}</span>
          <Link
            href={urlWithSearchText}
            target='_blank'
            className='flex items-center text-text-accent-light-mode-only'
            onClick={e => e.stopPropagation()}
          >
            <span>{t('plugin.searchInMarketplace')}</span>
            <RiArrowRightUpLine className='ml-0.5 h-3 w-3' />
          </Link>
        </div>
      )}
      <div className={cn('p-1', !disableMaxWidth && maxWidthClassName)} ref={nextToStickyELemRef}>
        {list.map((item, index) => (
          <Item
            key={index}
            payload={item}
            onAction={noop}
          />
        ))}
        {hasRes && (
          <div className='mb-3 mt-2 flex items-center justify-center space-x-2'>
            <div className="h-[2px] w-[90px] bg-gradient-to-l from-[rgba(16,24,40,0.08)] to-[rgba(255,255,255,0.01)]"></div>
            <Link
              href={urlWithSearchText}
              target='_blank'
              className='system-sm-medium flex h-4 shrink-0 items-center text-text-accent-light-mode-only'
            >
              <RiSearchLine className='mr-0.5 h-3 w-3' />
              <span>{t('plugin.searchInMarketplace')}</span>
            </Link>
            <div className="h-[2px] w-[90px] bg-gradient-to-l from-[rgba(255,255,255,0.01)] to-[rgba(16,24,40,0.08)]"></div>
          </div>
        )}
      </div>
    </>
  )
}

List.displayName = 'List'

export default List
