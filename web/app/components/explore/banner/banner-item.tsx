import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RiArrowRightLine } from '@remixicon/react'
import { useCarousel } from '@/app/components/base/carousel'
import { IndicatorButton } from './indicator-button'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

export type BannerData = {
  id: string
  content: {
    'category': string
    'title': string
    'description': string
    'img-src': string
  }
  status: 'enabled' | 'disabled'
  link: string
  created_at: number
}

type BannerItemProps = {
  banner: BannerData
  autoplayDelay: number
  isPaused?: boolean
}

const RESPONSIVE_BREAKPOINT = 1280
const MAX_RESPONSIVE_WIDTH = 600

export const BannerItem: FC<BannerItemProps> = ({ banner, autoplayDelay, isPaused = false }) => {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()
  const [resetKey, setResetKey] = useState(0)
  const textAreaRef = useRef<HTMLDivElement>(null)
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined)

  const slideInfo = useMemo(() => {
    const slides = api?.slideNodes() ?? []
    const totalSlides = slides.length
    const nextIndex = totalSlides > 0 ? (selectedIndex + 1) % totalSlides : 0
    return { slides, totalSlides, nextIndex }
  }, [api, selectedIndex])

  const responsiveStyle = useMemo(
    () => (maxWidth !== undefined ? { maxWidth: `${maxWidth}px` } : undefined),
    [maxWidth],
  )

  const incrementResetKey = useCallback(() => setResetKey(prev => prev + 1), [])

  // Update max width based on text area width when screen < 1280px
  useEffect(() => {
    const updateMaxWidth = () => {
      if (window.innerWidth < RESPONSIVE_BREAKPOINT && textAreaRef.current) {
        const textAreaWidth = textAreaRef.current.offsetWidth
        setMaxWidth(Math.min(textAreaWidth, MAX_RESPONSIVE_WIDTH))
      }
      else {
        setMaxWidth(undefined)
      }
    }

    updateMaxWidth()

    const resizeObserver = new ResizeObserver(updateMaxWidth)
    if (textAreaRef.current)
      resizeObserver.observe(textAreaRef.current)

    window.addEventListener('resize', updateMaxWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateMaxWidth)
    }
  }, [])

  // Reset progress when slide changes
  useEffect(() => {
    incrementResetKey()
  }, [selectedIndex, incrementResetKey])

  const handleClick = useCallback(() => {
    incrementResetKey()
    if (banner.link)
      window.open(banner.link, '_blank', 'noopener,noreferrer')
  }, [banner.link, incrementResetKey])

  const handleIndicatorClick = useCallback((index: number) => {
    incrementResetKey()
    api?.scrollTo(index)
  }, [api, incrementResetKey])

  return (
    <div
      className={cn(
        'relative flex w-full min-w-[784px] cursor-pointer overflow-hidden rounded-2xl bg-components-panel-on-panel-item-bg pr-[288px] transition-shadow hover:shadow-md',
      )}
      onClick={handleClick}
    >
      {/* Left content area */}
      <div className="min-w-0 flex-1">
        <div className="flex h-full flex-col gap-3 py-6 pl-8 pr-0">
          {/* Text section */}
          <div className="flex min-h-24 flex-wrap items-end gap-1 py-1">
            {/* Title area */}
            <div
              ref={textAreaRef}
              className="flex min-w-[480px] max-w-[680px] flex-[1_0_0] flex-col pr-4"
              style={responsiveStyle}
            >
              <p className="title-4xl-semi-bold line-clamp-1 text-dify-logo-dify-logo-blue">
                {banner.content.category}
              </p>
              <p className="title-4xl-semi-bold line-clamp-2 text-dify-logo-dify-logo-black">
                {banner.content.title}
              </p>
            </div>
            {/* Description area */}
            <div
              className="min-w-60 max-w-[600px] flex-[1_0_0] self-end overflow-hidden py-1 pr-4"
              style={responsiveStyle}
            >
              <p className="body-sm-regular line-clamp-4 overflow-hidden text-text-tertiary">
                {banner.content.description}
              </p>
            </div>
          </div>

          {/* Actions section */}
          <div className="flex flex-wrap items-center gap-1">
            {/* View more button */}
            <div
              className="flex min-w-[480px] max-w-[680px] flex-[1_0_0] items-center gap-[6px] py-1"
              style={responsiveStyle}
            >
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-text-accent p-[2px]">
                <RiArrowRightLine className="h-3 w-3 text-text-primary-on-surface" />
              </div>
              <span className="system-sm-semibold-uppercase text-text-accent">
                {t('explore.banner.viewMore')}
              </span>
            </div>

            {/* Slide navigation indicators */}
            <div
              className="flex min-w-60 max-w-[600px] flex-[1_0_0] items-center gap-2 py-1 pr-10"
              style={responsiveStyle}
            >
              {slideInfo.slides.map((_: unknown, index: number) => (
                <IndicatorButton
                  key={index}
                  index={index}
                  selectedIndex={selectedIndex}
                  isNextSlide={index === slideInfo.nextIndex}
                  autoplayDelay={autoplayDelay}
                  resetKey={resetKey}
                  isPaused={isPaused}
                  onClick={() => handleIndicatorClick(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right image area */}
      <div className="absolute right-0 top-0 flex h-full items-center p-2">
        <img
          src={banner.content['img-src']}
          alt={banner.content.title}
          className="aspect-[4/3] h-full max-w-[296px] rounded-xl"
        />
      </div>
    </div>
  )
}
