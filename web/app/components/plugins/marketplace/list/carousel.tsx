'use client'

import type { RemixiconComponentType } from '@remixicon/react'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'
import { useMemo } from 'react'
import { Carousel as BaseCarousel, useCarousel } from '@/app/components/base/carousel'
import { cn } from '@/utils/classnames'

type CarouselProps = {
  children: React.ReactNode
  className?: string
  gap?: number
  showNavigation?: boolean
  showPagination?: boolean
  autoPlay?: boolean
  autoPlayInterval?: number
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

type CarouselControlsProps = {
  showPagination: boolean
}

const CarouselControls = ({ showPagination }: CarouselControlsProps) => {
  const { api, selectedIndex, scrollPrev, scrollNext } = useCarousel()
  const scrollSnaps = api?.scrollSnapList() ?? []
  const totalPages = scrollSnaps.length

  if (totalPages <= 1)
    return null

  return (
    <div className="absolute -top-10 right-0 flex items-center gap-3">
      {showPagination && (
        <div className="flex items-center gap-1">
          {scrollSnaps.map((snap, index) => (
            <button
              key={snap}
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
          Icon={RiArrowLeftSLine}
        />
        <NavButton
          direction="right"
          disabled={totalPages <= 1}
          onClick={scrollNext}
          Icon={RiArrowRightSLine}
        />
      </div>
    </div>
  )
}

const Carousel = ({
  children,
  className,
  gap = 12,
  showNavigation = true,
  showPagination = true,
  autoPlay = false,
  autoPlayInterval = 5000,
}: CarouselProps) => {
  const plugins = useMemo(() => {
    if (!autoPlay)
      return []

    return [
      BaseCarousel.Plugin.Autoplay({
        delay: autoPlayInterval,
        stopOnInteraction: false,
        stopOnMouseEnter: true,
      }),
    ]
  }, [autoPlay, autoPlayInterval])

  return (
    <BaseCarousel
      opts={{ align: 'start', containScroll: 'trimSnaps', loop: true }}
      plugins={plugins}
      className={className}
      overlay={showNavigation ? <CarouselControls showPagination={showPagination} /> : null}
    >
      <BaseCarousel.Content style={{ columnGap: `${gap}px` }}>
        {children}
      </BaseCarousel.Content>
    </BaseCarousel>
  )
}

export default Carousel
