import type { UseEmblaCarouselType } from 'embla-carousel-react'
import { cn } from '@langgenius/dify-ui/cn'
import Autoplay from 'embla-carousel-autoplay'
import Fade from 'embla-carousel-fade'
import useEmblaCarousel from 'embla-carousel-react'
import * as React from 'react'

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = Readonly<{
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: 'horizontal' | 'vertical'
}>

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

  if (!context) throw new Error('useCarousel must be used within a <Carousel />')

  return context
}

function Carousel({
  ref,
  orientation = 'horizontal',
  opts,
  plugins,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  CarouselProps & { ref?: React.Ref<CarouselContextValue> }) {
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
    if (!api) return

    const onSelect = (api: CarouselApi) => {
      if (!api) return

      setSelectedIndex(api.selectedScrollSnap())
      setCanScrollPrev(api.canScrollPrev())
      setCanScrollNext(api.canScrollNext())
    }

    onSelect(api)
    api.on('reInit', onSelect)
    api.on('select', onSelect)

    return () => {
      api.off('reInit', onSelect)
      api.off('select', onSelect)
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
}

function CarouselContent({ ref, className, ...props }: React.ComponentPropsWithRef<'div'>) {
  const { orientation } = useCarousel()

  return (
    <div
      ref={ref}
      className={cn('flex', orientation === 'vertical' && 'flex-col', className)}
      {...props}
    />
  )
}

function CarouselItem({ ref, className, ...props }: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      className={cn('min-w-0 shrink-0 grow-0 basis-full', className)}
      {...props}
    />
  )
}

type CarouselActionProps = Readonly<{
  ref?: React.Ref<HTMLButtonElement>
  children?: React.ReactNode
}> &
  Omit<React.HTMLAttributes<HTMLButtonElement>, 'disabled' | 'onClick'>

function CarouselPrevious({ ref, children, ...props }: CarouselActionProps) {
  const { scrollPrev, canScrollPrev } = useCarousel()

  return (
    <button ref={ref} {...props} disabled={!canScrollPrev} onClick={scrollPrev}>
      {children}
    </button>
  )
}

function CarouselNext({ ref, children, ...props }: CarouselActionProps) {
  const { scrollNext, canScrollNext } = useCarousel()

  return (
    <button ref={ref} {...props} disabled={!canScrollNext} onClick={scrollNext}>
      {children}
    </button>
  )
}

function CarouselDot({ ref, children, ...props }: CarouselActionProps) {
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
}

const CarouselPlugins = {
  Autoplay,
  Fade,
}

Carousel.Content = CarouselContent
Carousel.Item = CarouselItem
Carousel.Previous = CarouselPrevious
Carousel.Next = CarouselNext
Carousel.Dot = CarouselDot
Carousel.Plugin = CarouselPlugins

export { Carousel, useCarousel }
