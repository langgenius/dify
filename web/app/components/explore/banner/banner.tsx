import type { ComponentProps } from 'react'
import type { Banner as BannerType } from '@/models/app'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { Carousel, useCarousel } from '@/app/components/base/carousel'
import { userProfileAtom } from '@/context/account-state'
import { useLocale } from '@/context/i18n'
import { BannerItem } from './banner-item'
import { IndicatorButton } from './indicator-button'

const AUTOPLAY_DELAY = 5000
const CAROUSEL_OPTIONS = {
  loop: true,
  watchDrag: (_api, event) =>
    !(event.target instanceof Element && event.target.closest('[data-carousel-control]')),
} satisfies NonNullable<ComponentProps<typeof Carousel>['opts']>

type BannerCarouselContentProps = {
  banners: BannerType[]
  accountId?: string
  language: string
}

function BannerCarouselContent({ banners, accountId, language }: BannerCarouselContentProps) {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()
  const [isPlaying, setIsPlaying] = useState(false)
  const trackedBannerKeysRef = useRef(new Set<string>())
  const nextIndex = (selectedIndex + 1) % banners.length
  const activeBanner = banners[selectedIndex]
  const trackingKey = accountId && activeBanner ? `${accountId}:${activeBanner.id}` : null

  const stopRotation = () => {
    const autoplay = api?.plugins().autoplay
    if (autoplay?.isPlaying()) autoplay.stop()
  }

  const selectBanner = (index: number) => {
    if (!api) return

    stopRotation()
    if (index === selectedIndex) return
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

  useEffect(() => {
    if (!api) return

    const handleAutoplayPlay = () => setIsPlaying(true)
    const handleAutoplayStop = () => setIsPlaying(false)

    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Embla owns this external playback state.
    setIsPlaying(api.plugins().autoplay?.isPlaying() ?? false)
    api.on('autoplay:play', handleAutoplayPlay)
    api.on('autoplay:stop', handleAutoplayStop)

    return () => {
      api.off('autoplay:play', handleAutoplayPlay)
      api.off('autoplay:stop', handleAutoplayStop)
    }
  }, [api])

  const controls =
    banners.length > 1 ? (
      <div
        data-carousel-control
        role="group"
        aria-label={t(($) => $['pagination.pageNumber'], { ns: 'common' })}
        className="pointer-events-auto flex min-w-0 shrink-0 items-center gap-2 py-1 @min-[996px]/banner:max-w-[600px] @min-[996px]/banner:min-w-60 @min-[996px]/banner:flex-[1_0_0] @min-[996px]/banner:pr-10"
        onFocusCapture={stopRotation}
      >
        <div className="flex items-center gap-0.5">
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
      <Carousel.Content aria-live={isPlaying ? 'off' : 'polite'}>
        {banners.map((banner, index) => {
          const isActive = index === selectedIndex

          return (
            <Carousel.Item
              key={banner.id}
              data-banner-id={banner.id}
              aria-label={banner.content.title}
              aria-hidden={!isActive}
              inert={!isActive}
            >
              <BannerItem
                banner={banner}
                sort={index + 1}
                language={language}
                accountId={accountId}
              />
            </Carousel.Item>
          )
        })}
      </Carousel.Content>

      {hasFooter ? (
        <div className="pointer-events-none absolute right-4 bottom-6 left-8 z-40 flex min-w-0 items-center justify-between gap-4 @min-[720px]/banner:right-64 @min-[996px]/banner:right-60 @min-[996px]/banner:flex-wrap @min-[996px]/banner:justify-start @min-[996px]/banner:gap-1">
          {activeBanner?.link ? (
            <div className="flex min-w-0 items-center gap-1.5 py-1 @min-[996px]/banner:max-w-[680px] @min-[996px]/banner:min-w-[480px] @min-[996px]/banner:flex-[1_0_0]">
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
    </>
  )
}

type BannerProps = {
  banners: BannerType[]
}

export function Banner({ banners }: BannerProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const userProfile = useAtomValue(userProfileAtom)
  const enabledBanners = banners.filter((banner) => banner.status === 'enabled')
  const carouselLabel = enabledBanners[0]?.content.category || enabledBanners[0]?.content.title
  const [carouselPlugins] = useState(() => [
    Carousel.Plugin.Fade(),
    Carousel.Plugin.Autoplay({
      delay: AUTOPLAY_DELAY,
      stopOnFocusIn: true,
      stopOnInteraction: true,
      stopOnMouseEnter: true,
      breakpoints: {
        '(prefers-reduced-motion: reduce)': { active: false },
      },
    }),
  ])

  return (
    <div className="relative flex w-full flex-col items-start gap-4 px-8 pt-6 pb-4">
      <div className="flex w-full flex-col gap-1">
        <p className="truncate title-3xl-semi-bold text-text-primary">
          {t(($) => $['banner.greeting'], { name: userProfile.name, ns: 'explore' })}
        </p>
        <p className="truncate body-sm-regular text-text-secondary">
          {t(($) => $['banner.tagline'], { ns: 'explore' })}
        </p>
      </div>

      {enabledBanners.length > 0 ? (
        <Carousel
          opts={CAROUSEL_OPTIONS}
          plugins={carouselPlugins}
          aria-label={carouselLabel}
          className="@container/banner w-full rounded-2xl"
        >
          <BannerCarouselContent
            banners={enabledBanners}
            accountId={userProfile.id}
            language={locale}
          />
        </Carousel>
      ) : null}
    </div>
  )
}
