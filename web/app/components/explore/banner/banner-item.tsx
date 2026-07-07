/* eslint-disable react/set-state-in-effect */
import type { KeyboardEvent } from 'react'
import type { Banner } from '@/models/app'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { useCarousel } from '@/app/components/base/carousel'
import { IndicatorButton } from './indicator-button'

type BannerItemProps = {
  banner: Banner
  autoplayDelay?: number
  sort: number
  language: string
  accountId?: string
  isPaused?: boolean
}

const RESPONSIVE_BREAKPOINT = 1200
const MAX_RESPONSIVE_WIDTH = 600
const INDICATOR_WIDTH = 20
const INDICATOR_GAP = 8
const MIN_VIEW_MORE_WIDTH = 160

export function BannerItem({
  banner,
  autoplayDelay = 5000,
  sort,
  language,
  accountId,
  isPaused = false,
}: BannerItemProps) {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()
  const { category, title, description, 'img-src': imgSrc } = banner.content

  const [resetKey, setResetKey] = useState(0)
  const textAreaRef = useRef<HTMLDivElement>(null)
  const maxWidthFrameRef = useRef<number | undefined>(undefined)
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined)

  const slideInfo = useMemo(() => {
    const slides = api?.slideNodes() ?? []
    const totalSlides = slides.length
    const nextIndex = totalSlides > 0 ? (selectedIndex + 1) % totalSlides : 0
    return { slides, totalSlides, nextIndex }
  }, [api, selectedIndex])
  const indicatorItems = useMemo(
    () => slideInfo.slides.map((slide, index) => ({
      id: slide.dataset?.bannerId ?? `${banner.id}-${index}`,
      index,
    })),
    [banner.id, slideInfo.slides],
  )

  const indicatorsWidth = useMemo(() => {
    const count = slideInfo.totalSlides
    if (count === 0)
      return 0
    // Calculate: indicator buttons + gaps + extra spacing (3 * 20px for divider and padding)
    return (count + 2) * INDICATOR_WIDTH + (count - 1) * INDICATOR_GAP
  }, [slideInfo.totalSlides])

  const viewMoreStyle = useMemo(() => {
    if (!maxWidth)
      return undefined
    const availableWidth = maxWidth - indicatorsWidth
    return {
      maxWidth: `${maxWidth}px`,
      minWidth: indicatorsWidth && availableWidth > 0 ? `${Math.min(availableWidth, MIN_VIEW_MORE_WIDTH)}px` : undefined,
    }
  }, [maxWidth, indicatorsWidth])

  const responsiveStyle = useMemo(
    () => (maxWidth !== undefined ? { maxWidth: `${maxWidth}px` } : undefined),
    [maxWidth],
  )

  const incrementResetKey = useCallback(() => setResetKey(prev => prev + 1), [])

  const updateMaxWidth = useCallback(() => {
    if (window.innerWidth < RESPONSIVE_BREAKPOINT && textAreaRef.current) {
      const textAreaWidth = textAreaRef.current.offsetWidth
      setMaxWidth(Math.min(textAreaWidth, MAX_RESPONSIVE_WIDTH))
    }
    else {
      setMaxWidth(undefined)
    }
  }, [])

  const scheduleMaxWidthUpdate = useCallback(() => {
    if (maxWidthFrameRef.current !== undefined)
      return

    maxWidthFrameRef.current = window.requestAnimationFrame(() => {
      maxWidthFrameRef.current = undefined
      updateMaxWidth()
    })
  }, [updateMaxWidth])

  useEffect(() => {
    scheduleMaxWidthUpdate()

    const resizeObserver = new ResizeObserver(scheduleMaxWidthUpdate)
    if (textAreaRef.current)
      resizeObserver.observe(textAreaRef.current)

    window.addEventListener('resize', scheduleMaxWidthUpdate)

    return () => {
      if (maxWidthFrameRef.current !== undefined) {
        window.cancelAnimationFrame(maxWidthFrameRef.current)
        maxWidthFrameRef.current = undefined
      }
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMaxWidthUpdate)
    }
  }, [scheduleMaxWidthUpdate])

  useEffect(() => {
    incrementResetKey()
  }, [selectedIndex, incrementResetKey])

  const handleIndicatorClick = useCallback((index: number) => {
    incrementResetKey()
    api?.scrollTo(index)
  }, [api, incrementResetKey])

  const handleBannerClick = useCallback(() => {
    incrementResetKey()

    trackEvent('explore_banner_click', {
      banner_id: banner.id,
      title: banner.content.title,
      sort,
      link: banner.link,
      page: 'explore',
      language,
      account_id: accountId,
      event_time: Date.now(),
    })

    if (banner.link)
      window.open(banner.link, '_blank', 'noopener,noreferrer')
  }, [accountId, banner, incrementResetKey, language, sort])
  const handleBannerKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return

    event.preventDefault()
    handleBannerClick()
  }, [handleBannerClick])

  return (
    <div
      className="flex h-[224px] w-full cursor-pointer items-start overflow-hidden rounded-2xl bg-components-panel-on-panel-item-bg shadow-xs outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid xl:h-[184px]"
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={handleBannerClick}
      onKeyDown={handleBannerKeyDown}
    >
      <div className="flex min-w-px flex-1 flex-col items-end self-stretch rounded-2xl py-6 pl-8">
        <div className="w-full min-w-0 pr-4" style={responsiveStyle}>
          <p className="line-clamp-1 h-[1.8rem] w-full title-4xl-semi-bold wrap-break-word text-dify-logo-blue">
            {category}
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 py-1 max-xl:flex-1 max-xl:justify-between">
          <div
            ref={textAreaRef}
            className="grid w-full grid-cols-[minmax(0,680px)_minmax(240px,600px)] gap-x-1 max-xl:grid-cols-1"
            style={responsiveStyle}
          >
            <div className="flex min-w-0 flex-col pr-4">
              <p className="line-clamp-2 min-h-[3.6rem] w-full title-4xl-semi-bold wrap-break-word text-dify-logo-black">
                {title}
              </p>
            </div>
            <div className="min-w-0 overflow-hidden pr-4">
              <p className="line-clamp-3 overflow-hidden body-sm-regular text-text-tertiary">
                {description}
              </p>
            </div>
          </div>

          <div
            className="flex w-full items-center justify-between gap-4 pr-4 xl:grid xl:grid-cols-[minmax(0,680px)_minmax(240px,600px)] xl:gap-x-1 xl:pr-0"
            style={responsiveStyle}
          >
            <div
              className="flex min-w-0 items-center gap-[6px] py-1 max-xl:flex-1"
              style={viewMoreStyle}
            >
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-text-accent p-[2px]">
                <span className="i-ri-arrow-right-line h-3 w-3 text-text-primary-on-surface" />
              </div>
              <span className="system-sm-semibold-uppercase text-text-accent">
                {t('banner.viewMore', { ns: 'explore' })}
              </span>
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-2 py-1 xl:pr-10">
              {/* Slide navigation indicators */}
              <div className="flex items-center gap-1">
                {indicatorItems.map(({ id, index }) => (
                  <IndicatorButton
                    key={id}
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
              <div className="hidden h-px flex-1 bg-divider-regular min-[1380px]:block" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-60 max-w-60 shrink-0 flex-col items-end self-stretch p-2 max-xl:w-[360px] max-xl:max-w-[360px] max-lg:hidden">
        <img
          src={imgSrc}
          alt={title}
          width={224}
          height={168}
          className="h-full w-full shrink-0 rounded-xl object-cover"
        />
      </div>
    </div>
  )
}
