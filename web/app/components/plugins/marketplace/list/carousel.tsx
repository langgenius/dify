'use client'

import type { RemixiconComponentType } from '@remixicon/react'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/utils/classnames'

type CarouselProps = {
  children: React.ReactNode
  className?: string
  itemWidth?: number
  gap?: number
  showNavigation?: boolean
  showPagination?: boolean
  autoPlay?: boolean
  autoPlayInterval?: number
}

type ScrollState = {
  canScrollLeft: boolean
  canScrollRight: boolean
  currentPage: number
  totalPages: number
}

const defaultScrollState: ScrollState = {
  canScrollLeft: false,
  canScrollRight: false,
  currentPage: 0,
  totalPages: 0,
}

type NavButtonProps = {
  direction: 'left' | 'right'
  disabled: boolean
  onClick: () => void
  Icon: RemixiconComponentType
}

const NavButton = ({ direction, disabled, onClick, Icon }: NavButtonProps) => (
  <button
    className={cn(
      'flex items-center justify-center rounded-full border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs backdrop-blur-[5px] transition-all',
      disabled
        ? 'cursor-not-allowed opacity-50'
        : 'cursor-pointer hover:bg-components-button-secondary-bg-hover',
    )}
    onClick={onClick}
    disabled={disabled}
    aria-label={`Scroll ${direction}`}
  >
    <Icon className="h-4 w-4 text-components-button-secondary-text" />
  </button>
)

const Carousel = ({
  children,
  className,
  itemWidth = 280,
  gap = 12,
  showNavigation = true,
  showPagination = true,
  autoPlay = false,
  autoPlayInterval = 5000,
}: CarouselProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollStateRef = useRef<ScrollState>(defaultScrollState)
  const [isHovered, setIsHovered] = useState(false)

  const calculateScrollState = useCallback((container: HTMLDivElement): ScrollState => {
    const { scrollLeft, scrollWidth, clientWidth } = container
    const canScrollLeft = scrollLeft > 0
    const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1

    // Calculate total pages based on actual scroll range
    const maxScrollLeft = scrollWidth - clientWidth
    const itemsPerPage = Math.floor(clientWidth / (itemWidth + gap))
    const totalItems = container.children.length
    const pages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

    // Calculate current page based on scroll position ratio
    let currentPage = 0
    if (maxScrollLeft > 0) {
      const scrollRatio = scrollLeft / maxScrollLeft
      currentPage = Math.round(scrollRatio * (pages - 1))
    }

    return {
      canScrollLeft,
      canScrollRight,
      totalPages: pages,
      currentPage: Math.min(Math.max(0, currentPage), pages - 1),
    }
  }, [itemWidth, gap])

  const subscribe = useCallback((onStoreChange: () => void) => {
    const container = containerRef.current
    if (!container)
      return () => { }

    const handleChange = () => {
      scrollStateRef.current = calculateScrollState(container)
      onStoreChange()
    }

    // Initial calculation
    handleChange()

    const resizeObserver = new ResizeObserver(handleChange)
    resizeObserver.observe(container)
    container.addEventListener('scroll', handleChange)

    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('scroll', handleChange)
    }
  }, [calculateScrollState])

  const getSnapshot = useCallback(() => scrollStateRef.current, [])

  const scrollState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Re-subscribe when children change
  useEffect(() => {
    const container = containerRef.current
    if (container)
      scrollStateRef.current = calculateScrollState(container)
  }, [children, calculateScrollState])

  const scroll = useCallback((direction: 'left' | 'right') => {
    const container = containerRef.current
    if (!container)
      return

    const scrollAmount = container.clientWidth - (itemWidth / 2)
    const newScrollLeft = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount

    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth',
    })
  }, [itemWidth])

  const scrollToPage = useCallback((pageIndex: number) => {
    const container = containerRef.current
    if (!container)
      return

    const itemsPerPage = Math.floor(container.clientWidth / (itemWidth + gap))
    const scrollLeft = pageIndex * itemsPerPage * (itemWidth + gap)

    container.scrollTo({
      left: scrollLeft,
      behavior: 'smooth',
    })
  }, [itemWidth, gap])

  // Auto-play functionality
  useEffect(() => {
    if (!autoPlay || isHovered || scrollState.totalPages <= 1)
      return

    const interval = setInterval(() => {
      const nextPage = scrollState.canScrollRight
        ? scrollState.currentPage + 1
        : 0 // Loop back to first page
      scrollToPage(nextPage)
    }, autoPlayInterval)

    return () => clearInterval(interval)
  }, [autoPlay, autoPlayInterval, isHovered, scrollState.totalPages, scrollState.canScrollRight, scrollState.currentPage, scrollToPage])

  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])

  return (
    <div
      className={cn('relative', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Navigation arrows */}
      {showNavigation && (
        <div className="absolute -top-10 right-0 flex items-center gap-3">
          {/* Pagination dots */}
          {showPagination && scrollState.totalPages > 1 && (
            <div className="flex items-center gap-1">
              {Array.from({ length: scrollState.totalPages }).map((_, index) => (
                <button
                  key={index}
                  className={cn(
                    'h-[5px] w-[5px] rounded-full transition-all',
                    scrollState.currentPage === index
                      ? 'w-4 bg-components-button-primary-bg'
                      : 'bg-components-button-secondary-border hover:bg-components-button-secondary-border-hover',
                  )}
                  onClick={() => scrollToPage(index)}
                  aria-label={`Go to page ${index + 1}`}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1">
            <NavButton
              direction="left"
              disabled={!scrollState.canScrollLeft}
              onClick={() => scroll('left')}
              Icon={RiArrowLeftSLine}
            />
            <NavButton
              direction="right"
              disabled={!scrollState.canScrollRight}
              onClick={() => scroll('right')}
              Icon={RiArrowRightSLine}
            />
          </div>
        </div>
      )}

      {/* Scrollable container */}
      <div
        ref={containerRef}
        className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth"
        style={{
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default Carousel
