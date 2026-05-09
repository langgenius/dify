/* eslint-disable react/set-state-in-effect */
import type { FC } from 'react'
import type { Banner } from '@/models/app'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { useCarousel } from '@/app/components/base/carousel'
import { IndicatorButton } from './indicator-button'

type BannerItemProps = {
  banner: Banner
  autoplayDelay: number
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

export const BannerItem: FC<BannerItemProps> = ({
  banner,
  autoplayDelay,
  sort,
  language,
  accountId,
  isPaused = false,
}) => {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()
  const { category, title, description, 'img-src': imgSrc } = banner.content

  const [resetKey, setResetKey] = useState(0)
  const textAreaRef = useRef<HTMLDivElement>(null)
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined)

  const slideInfo = useMemo(() => {
    const slides = api?.slideNodes() ?? []
    const totalSlides = slides.length
    const nextIndex = totalSlides > 0 ? (selectedIndex + 1) % totalSlides : 0
    return { slides, totalSlides, nextIndex }
  }, [api, selectedIndex])

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

  return (
    <div
      className="flex min-h-[168px] w-full cursor-pointer items-center gap-2 overflow-hidden rounded-2xl px-8"
      onClick={handleBannerClick}
    >
      <div className="flex h-[200px] min-w-px flex-1 flex-col items-end gap-3 rounded-2xl pt-4 pb-8">
        <div className="flex min-h-24 w-full flex-wrap items-end gap-1 py-1">
          <div
            ref={textAreaRef}
            className="flex max-w-[680px] min-w-[480px] flex-[1_1_480px] flex-col pr-4 max-xl:min-w-0"
            style={responsiveStyle}
          >
            <p className="line-clamp-1 title-4xl-semi-bold text-dify-logo-blue">
              {category}
            </p>
            <p className="line-clamp-2 title-4xl-semi-bold text-dify-logo-black">
              {title}
            </p>
          </div>
          <div
            className="max-w-[600px] min-w-0 flex-[1_1_240px] self-end overflow-hidden py-1 pr-4"
            style={responsiveStyle}
          >
            <p className="line-clamp-4 overflow-hidden body-sm-regular text-text-tertiary">
              {description}
            </p>
          </div>
        </div>

        {/* Actions section */}
        <div className="flex w-full flex-wrap items-center gap-1">
          {/* View more button */}
          <div
            className="flex max-w-[680px] min-w-[480px] flex-[1_1_480px] items-center gap-[6px] py-1 max-xl:min-w-0"
            style={viewMoreStyle}
          >
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-text-accent p-[2px]">
              <span className="i-ri-arrow-right-line h-3 w-3 text-text-primary-on-surface" />
            </div>
            <span className="system-sm-semibold-uppercase text-text-accent">
              {t('banner.viewMore', { ns: 'explore' })}
            </span>
          </div>

          <div
            className="flex max-w-[600px] min-w-60 flex-[1_1_240px] items-center gap-2 py-1 pr-10 max-xl:min-w-0"
            style={responsiveStyle}
          >
            {/* Slide navigation indicators */}
            <div className="flex items-center gap-1">
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
            <div className="hidden h-px flex-1 bg-divider-regular min-[1380px]:block" />
          </div>
        </div>
      </div>

      <div className="flex max-w-60 shrink-0 flex-col items-center justify-center p-4 max-lg:hidden">
        <img
          src={imgSrc}
          alt={title}
          className="h-[168px] w-56 shrink-0 rounded-xl object-cover"
        />
      </div>
    </div>
  )
}
