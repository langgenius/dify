/* eslint-disable react-hooks-extra/no-direct-set-state-in-use-effect */
import type { UseEmblaCarouselType } from 'embla-carousel-react'
import Autoplay from 'embla-carousel-autoplay'
import useEmblaCarousel from 'embla-carousel-react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: 'horizontal' | 'vertical'
}

type CarouselContextValue = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  api: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  selectedIndex: number
  canScrollPrev: boolean
  canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextValue | null>(null)

function useCarousel() {
  const context = React.useContext(CarouselContext)

  if (!context)
    throw new Error('useCarousel must be used within a <Carousel />')

  return context
}

type TCarousel = {
  Content: typeof CarouselContent
  Item: typeof CarouselItem
  Previous: typeof CarouselPrevious
  Next: typeof CarouselNext
  Dot: typeof CarouselDot
  Plugin: typeof CarouselPlugins
} & React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & CarouselProps & React.RefAttributes<CarouselContextValue>
>

const Carousel: TCarousel = React.forwardRef(
  ({ orientation = 'horizontal', opts, plugins, className, children, ...props }, ref) => {
    const [carouselRef, api] = useEmblaCarousel(
      { ...opts, axis: orientation === 'horizontal' ? 'x' : 'y' },
      plugins,
    )
    const [canScrollPrev, setCanScrollPrev] = React.useState(false)
    const [canScrollNext, setCanScrollNext] = React.useState(false)
    const [selectedIndex, setSelectedIndex] = React.useState(0)

    const scrollPrev = React.useCallback(() => {
      api?.scrollPrev()
    }, [api])

    const scrollNext = React.useCallback(() => {
      api?.scrollNext()
    }, [api])

    React.useEffect(() => {
      if (!api)
        return

      const onSelect = (api: CarouselApi) => {
        if (!api)
          return

        setSelectedIndex(api.selectedScrollSnap())
        setCanScrollPrev(api.canScrollPrev())
        setCanScrollNext(api.canScrollNext())
      }

      onSelect(api)
      api.on('reInit', onSelect)
      api.on('select', onSelect)

      return () => {
        api?.off('select', onSelect)
      }
    }, [api])

    React.useImperativeHandle(ref, () => ({
      carouselRef,
      api,
      opts,
      orientation,
      scrollPrev,
      scrollNext,
      selectedIndex,
      canScrollPrev,
      canScrollNext,
    }))

    return (
      <CarouselContext.Provider
        value={{
          carouselRef,
          api,
          opts,
          orientation,
          scrollPrev,
          scrollNext,
          selectedIndex,
          canScrollPrev,
          canScrollNext,
        }}
      >
        <div
          ref={carouselRef}
          // onKeyDownCapture={handleKeyDown}
          className={cn('relative overflow-hidden', className)}
          role="region"
          aria-roledescription="carousel"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    )
  },
) as TCarousel
Carousel.displayName = 'Carousel'

const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { orientation } = useCarousel()

    return (
      <div
        ref={ref}
        className={cn('flex', orientation === 'vertical' && 'flex-col', className)}
        {...props}
      />
    )
  },
)
CarouselContent.displayName = 'CarouselContent'

const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="group"
        aria-roledescription="slide"
        className={cn('min-w-0 shrink-0 grow-0 basis-full', className)}
        {...props}
      />
    )
  },
)
CarouselItem.displayName = 'CarouselItem'

type CarouselActionProps = {
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLButtonElement>, 'disabled' | 'onClick'>

const CarouselPrevious = React.forwardRef<HTMLButtonElement, CarouselActionProps>(
  ({ children, ...props }, ref) => {
    const { scrollPrev, canScrollPrev } = useCarousel()

    return (
      <button ref={ref} {...props} disabled={!canScrollPrev} onClick={scrollPrev}>
        {children}
      </button>
    )
  },
)
CarouselPrevious.displayName = 'CarouselPrevious'

const CarouselNext = React.forwardRef<HTMLButtonElement, CarouselActionProps>(
  ({ children, ...props }, ref) => {
    const { scrollNext, canScrollNext } = useCarousel()

    return (
      <button ref={ref} {...props} disabled={!canScrollNext} onClick={scrollNext}>
        {children}
      </button>
    )
  },
)
CarouselNext.displayName = 'CarouselNext'

const CarouselDot = React.forwardRef<HTMLButtonElement, CarouselActionProps>(
  ({ children, ...props }, ref) => {
    const { api, selectedIndex } = useCarousel()

    return api?.slideNodes().map((_, index) => {
      return (
        <button
          key={index}
          ref={ref}
          {...props}
          data-state={index === selectedIndex ? 'active' : 'inactive'}
          onClick={() => {
            api.scrollTo(index)
          }}
        >
          {children}
        </button>
      )
    })
  },
)
CarouselDot.displayName = 'CarouselDot'

const CarouselPlugins = {
  Autoplay,
}

Carousel.Content = CarouselContent
Carousel.Item = CarouselItem
Carousel.Previous = CarouselPrevious
Carousel.Next = CarouselNext
Carousel.Dot = CarouselDot
Carousel.Plugin = CarouselPlugins

export { Carousel, useCarousel }
