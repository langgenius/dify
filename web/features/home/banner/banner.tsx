import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import type {
  ComponentProps,
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { Carousel, useCarousel } from '@/app/components/base/carousel'
import { useLocale } from '@/context/i18n'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { BannerItem } from './banner-item'
import { IndicatorButton } from './indicator-button'

const AUTOPLAY_DELAY = 5000
const CAROUSEL_OPTIONS = {
  container: '[data-banner-carousel-slides]',
  loop: true,
  watchDrag: (_api, event) =>
    !(event.target instanceof Element && event.target.closest('[data-carousel-control]')),
} satisfies NonNullable<ComponentProps<typeof Carousel>['opts']>
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

type CarouselApi = ReturnType<typeof useCarousel>['api']

type BannerCarouselContentProps = {
  banners: BannerResponse[]
  accountId?: string
  language: string
  isPlaying: boolean
  isRotationEnabled: boolean
  onToggleRotation: () => void
  onRotationControlPointerDown: () => void
  onApiChange: (api: NonNullable<CarouselApi>) => void
}

type BannerSlideProps = {
  banner: BannerResponse
  index: number
  isActive: boolean
  accountId?: string
  language: string
}

function BannerSlide({ banner, index, isActive, accountId, language }: BannerSlideProps) {
  const titleId = useId()

  return (
    <Carousel.Item
      data-banner-id={banner.id}
      aria-labelledby={titleId}
      aria-hidden={!isActive}
      inert={!isActive}
    >
      <BannerItem
        banner={banner}
        sort={index + 1}
        language={language}
        accountId={accountId}
        titleId={titleId}
      />
    </Carousel.Item>
  )
}

function BannerCarouselContent({
  banners,
  accountId,
  language,
  isPlaying,
  isRotationEnabled,
  onToggleRotation,
  onRotationControlPointerDown,
  onApiChange,
}: BannerCarouselContentProps) {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()
  const trackedBannerKeysRef = useRef(new Set<string>())
  const nextIndex = (selectedIndex + 1) % banners.length
  const activeBanner = banners[selectedIndex]
  const trackingKey = accountId && activeBanner ? `${accountId}:${activeBanner.id}` : null

  useEffect(() => {
    if (api) onApiChange(api)
  }, [api, onApiChange])

  const selectBanner = (index: number) => {
    if (!api || index === selectedIndex) return
    api.scrollTo(index)
  }

  useEffect(() => {
    if (!accountId || !activeBanner || !trackingKey) return
    if (trackedBannerKeysRef.current.has(trackingKey)) return

    trackEvent('explore_banner_impression', {
      banner_id: activeBanner.id,
      title: activeBanner.content.title,
      sort: selectedIndex + 1,
      link: activeBanner.link,
      page: 'explore',
      language,
      account_id: accountId,
      event_time: Date.now(),
    })
    trackedBannerKeysRef.current.add(trackingKey)
  }, [accountId, activeBanner, language, selectedIndex, trackingKey])

  const controls =
    banners.length > 1 ? (
      <div
        data-carousel-control
        className="pointer-events-auto flex h-7 min-w-0 shrink-0 items-center gap-2 @min-[996px]/banner:max-w-150 @min-[996px]/banner:min-w-60 @min-[996px]/banner:flex-[1_0_0] @min-[996px]/banner:pr-10"
      >
        <IconButton
          size="md"
          aria-label={t(
            ($) => $[isRotationEnabled ? 'banner.stopRotation' : 'banner.startRotation'],
            { ns: 'explore' },
          )}
          className="shrink-0"
          onPointerDownCapture={onRotationControlPointerDown}
          onClick={onToggleRotation}
        >
          <span
            aria-hidden="true"
            className={
              isRotationEnabled ? 'i-ri-pause-circle-line size-4' : 'i-ri-play-circle-line size-4'
            }
          />
        </IconButton>
        <div
          role="group"
          aria-label={t(($) => $['pagination.pageNumber'], { ns: 'common' })}
          className="flex items-center gap-0.5"
        >
          {banners.map((banner, index) => (
            <IndicatorButton
              key={banner.id}
              index={index}
              label={`${String(index + 1).padStart(2, '0')} ${banner.content.title}`}
              isCurrent={index === selectedIndex}
              isNextSlide={index === nextIndex}
              autoplayDelay={AUTOPLAY_DELAY}
              isPaused={!isPlaying}
              onClick={() => selectBanner(index)}
            />
          ))}
        </div>
        <div className="hidden h-px flex-1 bg-divider-regular @min-[1068px]/banner:block" />
      </div>
    ) : null
  const hasFooter = Boolean(activeBanner?.link || controls)

  return (
    <>
      {hasFooter ? (
        <div className="pointer-events-none absolute right-4 bottom-6 left-8 z-40 flex min-w-0 items-center justify-between gap-4 @min-[720px]/banner:right-64 @min-[996px]/banner:right-60 @min-[996px]/banner:flex-wrap @min-[996px]/banner:justify-start @min-[996px]/banner:gap-1">
          {activeBanner?.link ? (
            <div className="flex min-w-0 items-center gap-1.5 py-1 @min-[996px]/banner:max-w-170 @min-[996px]/banner:min-w-120 @min-[996px]/banner:flex-[1_0_0]">
              <span className="flex size-4 items-center justify-center rounded-full bg-text-accent p-0.5">
                <span
                  className="i-ri-arrow-right-line size-3 text-text-primary-on-surface"
                  aria-hidden="true"
                />
              </span>
              <span className="truncate system-sm-semibold-uppercase text-text-accent">
                {t(($) => $['banner.viewMore'], { ns: 'explore' })}
              </span>
            </div>
          ) : null}
          {controls}
        </div>
      ) : null}

      <Carousel.Content data-banner-carousel-slides aria-live={isPlaying ? 'off' : 'polite'}>
        {banners.map((banner, index) => (
          <BannerSlide
            key={banner.id}
            banner={banner}
            index={index}
            isActive={index === selectedIndex}
            accountId={accountId}
            language={language}
          />
        ))}
      </Carousel.Content>
    </>
  )
}

function setAutoplayPlaying(api: CarouselApi, shouldPlay: boolean) {
  const autoplay = api?.plugins().autoplay
  if (!autoplay || autoplay.isPlaying() === shouldPlay) return

  if (shouldPlay) autoplay.play()
  else autoplay.stop()
}

type BannerProps = {
  banners: BannerResponse[]
}

export function Banner({ banners }: BannerProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const [api, setApi] = useState<CarouselApi>()
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRotationEnabled, setIsRotationEnabled] = useState(false)
  const isRotationEnabledRef = useRef(false)
  const isPointerInsideRef = useRef(false)
  const isPointerActivationRef = useRef(false)
  const hasExplicitRotationPreferenceRef = useRef(false)
  const [carouselPlugins] = useState(() => [
    Carousel.Plugin.Fade(),
    Carousel.Plugin.Autoplay({
      delay: AUTOPLAY_DELAY,
      playOnInit: false,
      stopOnFocusIn: false,
      stopOnInteraction: true,
      stopOnMouseEnter: false,
    }),
  ])

  const toggleRotation = () => {
    const nextRotationEnabled = !isRotationEnabledRef.current
    hasExplicitRotationPreferenceRef.current = true
    isRotationEnabledRef.current = nextRotationEnabled
    setIsRotationEnabled(nextRotationEnabled)
    setAutoplayPlaying(api, nextRotationEnabled && !isPointerInsideRef.current)
  }

  const stopRotationForFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return
    if (isPointerActivationRef.current) return

    hasExplicitRotationPreferenceRef.current = true
    if (!isRotationEnabledRef.current) return

    isRotationEnabledRef.current = false
    setIsRotationEnabled(false)
    setAutoplayPlaying(api, false)
  }

  const pauseRotationForPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return

    isPointerInsideRef.current = true
    setAutoplayPlaying(api, false)
  }

  const resumeRotationAfterPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return

    isPointerActivationRef.current = false
    isPointerInsideRef.current = false
    setAutoplayPlaying(api, isRotationEnabledRef.current)
  }

  const markPointerActivation = () => {
    isPointerActivationRef.current = true
  }

  const clearPointerActivation = () => {
    isPointerActivationRef.current = false
  }

  useEffect(() => {
    if (!api || banners.length <= 1) return

    const autoplay = api.plugins().autoplay
    if (!autoplay) return

    const syncPlaybackToIntent = () => {
      setAutoplayPlaying(api, isRotationEnabledRef.current && !isPointerInsideRef.current)
    }
    const handleAutoplayPlay = () => {
      if (!isRotationEnabledRef.current || isPointerInsideRef.current) {
        autoplay.stop()
        return
      }
      setIsPlaying(true)
    }
    const handleAutoplayStop = () => setIsPlaying(false)
    const handleReInit = () => {
      syncPlaybackToIntent()
      setIsPlaying(autoplay.isPlaying())
    }
    const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const applyMotionPreference = () => {
      if (reducedMotionQuery.matches) {
        isRotationEnabledRef.current = false
        // oxlint-disable-next-line eslint-react/set-state-in-effect -- The media query is an external browser preference.
        setIsRotationEnabled(false)
      } else if (!hasExplicitRotationPreferenceRef.current) {
        isRotationEnabledRef.current = true
        setIsRotationEnabled(true)
      }
      syncPlaybackToIntent()
    }

    api.on('autoplay:play', handleAutoplayPlay)
    api.on('autoplay:stop', handleAutoplayStop)
    api.on('reInit', handleReInit)
    reducedMotionQuery.addEventListener('change', applyMotionPreference)
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Embla owns this external playback state.
    setIsPlaying(autoplay.isPlaying())
    applyMotionPreference()

    return () => {
      api.off('autoplay:play', handleAutoplayPlay)
      api.off('autoplay:stop', handleAutoplayStop)
      api.off('reInit', handleReInit)
      reducedMotionQuery.removeEventListener('change', applyMotionPreference)
    }
  }, [api, banners.length])

  if (banners.length === 0) return null

  return (
    <div className="relative flex w-full flex-col items-start px-8 pb-4">
      <Carousel
        opts={CAROUSEL_OPTIONS}
        plugins={carouselPlugins}
        aria-label={t(($) => $['banner.carouselLabel'], { ns: 'explore' })}
        className="@container/banner w-full rounded-2xl"
        onFocusCapture={stopRotationForFocus}
        onPointerOver={pauseRotationForPointer}
        onPointerOut={resumeRotationAfterPointer}
        onPointerUpCapture={clearPointerActivation}
        onPointerCancelCapture={clearPointerActivation}
      >
        <BannerCarouselContent
          banners={banners}
          accountId={userProfile.id}
          language={locale}
          isPlaying={isPlaying}
          isRotationEnabled={isRotationEnabled}
          onToggleRotation={toggleRotation}
          onRotationControlPointerDown={markPointerActivation}
          onApiChange={setApi}
        />
      </Carousel>
    </div>
  )
}
