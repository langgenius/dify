import type { Banner as BannerType } from '@/models/app'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { Carousel, useCarousel } from '@/app/components/base/carousel'
import { userProfileAtom } from '@/context/account-state'
import { useLocale } from '@/context/i18n'
import { BannerItem } from './banner-item'

const AUTOPLAY_DELAY = 5000
const RESIZE_DEBOUNCE_DELAY = 50

type BannerImpressionTrackerProps = {
  banners: BannerType[]
  accountId?: string
  language: string
  trackedBannerIdsRef: React.MutableRefObject<Set<string>>
}

function BannerImpressionTracker({
  banners,
  accountId,
  language,
  trackedBannerIdsRef,
}: BannerImpressionTrackerProps) {
  const { selectedIndex } = useCarousel()

  useEffect(() => {
    if (!accountId) return

    const currentBanner = banners[selectedIndex]
    if (!currentBanner || trackedBannerIdsRef.current.has(currentBanner.id)) return

    trackEvent('explore_banner_impression', {
      banner_id: currentBanner.id,
      title: currentBanner.content.title,
      sort: selectedIndex + 1,
      link: currentBanner.link,
      page: 'explore',
      language,
      account_id: accountId,
      event_time: Date.now(),
    })
    trackedBannerIdsRef.current.add(currentBanner.id)
  }, [accountId, banners, language, selectedIndex, trackedBannerIdsRef])

  return null
}

type BannerProps = {
  banners: BannerType[]
}

function Banner({ banners }: BannerProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const userProfile = useAtomValue(userProfileAtom)
  const accountId = userProfile.id
  const userName = userProfile.name
  const [isHovered, setIsHovered] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const resizeTimerRef = useRef<NodeJS.Timeout | null>(null)
  const trackedBannerIdsRef = useRef<Set<string>>(new Set())

  const enabledBanners = useMemo(
    () => banners?.filter((banner) => banner.status === 'enabled') ?? [],
    [banners],
  )

  const isPaused = isHovered || isResizing
  const notShowSlider = enabledBanners.length === 0

  // Handle window resize to pause animation
  useEffect(() => {
    const handleResize = () => {
      setIsResizing(true)

      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)

      resizeTimerRef.current = setTimeout(() => {
        setIsResizing(false)
      }, RESIZE_DEBOUNCE_DELAY)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [])

  return (
    <div
      className="relative flex w-full flex-col items-start gap-4 px-8 pt-6 pb-4"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex w-full flex-col gap-1">
        <p className="truncate title-3xl-semi-bold text-text-primary">
          {t(($) => $['banner.greeting'], { name: userName, ns: 'explore' })}
        </p>
        <p className="truncate body-sm-regular text-text-secondary">
          {t(($) => $['banner.tagline'], { ns: 'explore' })}
        </p>
      </div>

      {!notShowSlider && (
        <Carousel
          opts={{ loop: true }}
          plugins={[
            Carousel.Plugin.Fade(),
            Carousel.Plugin.Autoplay({
              delay: AUTOPLAY_DELAY,
              stopOnInteraction: false,
              stopOnMouseEnter: true,
            }),
          ]}
          className="w-full rounded-2xl"
        >
          <BannerImpressionTracker
            banners={enabledBanners}
            accountId={accountId}
            language={locale}
            trackedBannerIdsRef={trackedBannerIdsRef}
          />
          <Carousel.Content>
            {enabledBanners.map((banner, index) => (
              <Carousel.Item key={banner.id} data-banner-id={banner.id}>
                <BannerItem
                  banner={banner}
                  autoplayDelay={AUTOPLAY_DELAY}
                  isPaused={isPaused}
                  sort={index + 1}
                  language={locale}
                  accountId={accountId}
                />
              </Carousel.Item>
            ))}
          </Carousel.Content>
        </Carousel>
      )}
    </div>
  )
}

export default React.memo(Banner)
