'use client'

/* eslint-disable eslint-react/set-state-in-effect */
import { cn } from '@langgenius/dify-ui/cn'
import Autoplay from 'embla-carousel-autoplay'
import useEmblaCarousel from 'embla-carousel-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type CarouselApi = ReturnType<typeof useEmblaCarousel>[1]

type CarouselProps = {
  children: React.ReactNode
  className?: string
  showNavigation?: boolean
  showPagination?: boolean
  autoPlay?: boolean
  autoPlayInterval?: number
}

type NavButtonProps = {
  direction: 'left' | 'right'
  disabled: boolean
  onClick: () => void
  iconClassName: string
}

const NavButton = ({ direction, disabled, onClick, iconClassName }: NavButtonProps) => (
  <button
    className={cn(
      'flex cursor-pointer items-center justify-center rounded-full border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs backdrop-blur-[5px] transition-all hover:bg-components-button-secondary-bg-hover',
      disabled && 'cursor-not-allowed opacity-50 hover:bg-components-button-secondary-bg',
    )}
    onClick={onClick}
    disabled={disabled}
    aria-label={`Scroll ${direction}`}
  >
    <span
      aria-hidden
      className={cn('size-4 text-components-button-secondary-text', iconClassName)}
    />
  </button>
)

type CarouselControlsProps = {
  api: CarouselApi
  showPagination: boolean
  selectedIndex: number
  scrollNext: () => void
  scrollPrev: () => void
  scrollSnaps: number[]
}

const CarouselControls = ({
  api,
  showPagination,
  selectedIndex,
  scrollNext,
  scrollPrev,
  scrollSnaps,
}: CarouselControlsProps) => {
  const paginationItems = scrollSnaps.map((snap, index) => ({
    id: `${snap}-${index}`,
    snap,
  }))
  const totalPages = scrollSnaps.length

  if (totalPages <= 1) return null

  return (
    <div className="absolute -top-10 right-0 flex items-center gap-3">
      {showPagination && (
        <div className="flex items-center gap-1">
          {paginationItems.map((item, index) => (
            <button
              key={item.id}
              className={cn(
                'h-[5px] w-[5px] rounded-full transition-all',
                selectedIndex === index
                  ? 'w-4 bg-components-button-primary-bg'
                  : 'bg-components-button-secondary-border hover:bg-components-button-secondary-border-hover',
              )}
              onClick={() => api?.scrollTo(index)}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <NavButton
          direction="left"
          disabled={totalPages <= 1}
          onClick={scrollPrev}
          iconClassName="i-ri-arrow-left-s-line"
        />
        <NavButton
          direction="right"
          disabled={totalPages <= 1}
          onClick={scrollNext}
          iconClassName="i-ri-arrow-right-s-line"
        />
      </div>
    </div>
  )
}

const Carousel = ({
  children,
  className,
  showNavigation = true,
  showPagination = true,
  autoPlay = false,
  autoPlayInterval = 5000,
}: CarouselProps) => {
  const plugins = useMemo(() => {
    if (!autoPlay) return []

    return [
      Autoplay({
        delay: autoPlayInterval,
        stopOnInteraction: false,
        stopOnMouseEnter: true,
      }),
    ]
  }, [autoPlay, autoPlayInterval])
  const [carouselRef, api] = useEmblaCarousel(
    { align: 'start', containScroll: 'trimSnaps', loop: true },
    plugins,
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([])
  const scrollPrev = useCallback(() => {
    api?.scrollPrev()
  }, [api])
  const scrollNext = useCallback(() => {
    api?.scrollNext()
  }, [api])

  useEffect(() => {
    if (!api) return

    const handleSelect = () => {
      setSelectedIndex(api.selectedScrollSnap())
      setScrollSnaps(api.scrollSnapList())
    }

    handleSelect()
    api.on('reInit', handleSelect)
    api.on('select', handleSelect)

    return () => {
      api.off('reInit', handleSelect)
      api.off('select', handleSelect)
    }
  }, [api])

  return (
    <div className={cn('relative', className)} role="region" aria-roledescription="carousel">
      {showNavigation && (
        <CarouselControls
          api={api}
          showPagination={showPagination}
          selectedIndex={selectedIndex}
          scrollNext={scrollNext}
          scrollPrev={scrollPrev}
          scrollSnaps={scrollSnaps}
        />
      )}
      <div ref={carouselRef} className="overflow-hidden [border-radius:inherit]">
        <div className="flex" style={{ columnGap: '12px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default Carousel
