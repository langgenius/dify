import type { FC } from 'react'
import type { Banner as BannerType } from '@/models/app'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { Carousel, useCarousel } from '@/app/components/base/carousel'
import { useSelector } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { useGetBanners } from '@/service/use-explore'
import Loading from '../../base/loading'
import { BannerItem } from './banner-item'

const AUTOPLAY_DELAY = 5000
const MIN_LOADING_HEIGHT = 168
const RESIZE_DEBOUNCE_DELAY = 50

const LoadingState: FC = () => (
  <div
    className="flex items-center justify-center rounded-[24px] bg-background-default-dodge shadow-xs"
    style={{ minHeight: MIN_LOADING_HEIGHT }}
  >
    <Loading />
  </div>
)

type BannerImpressionTrackerProps = {
  banners: BannerType[]
  accountId?: string
  language: string
  trackedBannerIdsRef: React.MutableRefObject<Set<string>>
}

const BannerImpressionTracker: FC<BannerImpressionTrackerProps> = ({
  banners,
  accountId,
  language,
  trackedBannerIdsRef,
}) => {
  const { selectedIndex } = useCarousel()

  useEffect(() => {
    if (!accountId)
      return

    const currentBanner = banners[selectedIndex]
    if (!currentBanner || trackedBannerIdsRef.current.has(currentBanner.id))
      return

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

const Banner: FC = () => {
  const { t } = useTranslation()
  const locale = useLocale()
  const { data: banners, isLoading, isError } = useGetBanners(locale)
  const accountId = useSelector(s => s.userProfile.id)
  const userName = useSelector(s => s.userProfile.name)
  const [isHovered, setIsHovered] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const resizeTimerRef = useRef<NodeJS.Timeout | null>(null)
  const trackedBannerIdsRef = useRef<Set<string>>(new Set())

  const enabledBanners = useMemo(
    () => banners?.filter(banner => banner.status === 'enabled') ?? [],
    [banners],
  )

  const isPaused = isHovered || isResizing

  // Handle window resize to pause animation
  useEffect(() => {
    const handleResize = () => {
      setIsResizing(true)

      if (resizeTimerRef.current)
        clearTimeout(resizeTimerRef.current)

      resizeTimerRef.current = setTimeout(() => {
        setIsResizing(false)
      }, RESIZE_DEBOUNCE_DELAY)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimerRef.current)
        clearTimeout(resizeTimerRef.current)
    }
  }, [])

  if (isLoading)
    return <LoadingState />

  if (isError || enabledBanners.length === 0)
    return null

  return (
    <div
      className="relative flex w-full flex-col items-start overflow-hidden rounded-[24px] bg-background-default-dodge transition-shadow hover:shadow-xs"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex w-full flex-col gap-1 px-8 pt-8">
        <p className="truncate title-5xl-semi-bold text-dify-logo-black">
          {t('banner.greeting', { name: userName, ns: 'explore' })}
        </p>
        <p className="truncate body-md-regular text-text-secondary">
          {t('banner.tagline', { ns: 'explore' })}
        </p>
      </div>

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
        className="w-full rounded-2xl shadow-xs"
      >
        <BannerImpressionTracker
          banners={enabledBanners}
          accountId={accountId}
          language={locale}
          trackedBannerIdsRef={trackedBannerIdsRef}
        />
        <Carousel.Content>
          {enabledBanners.map((banner, index) => (
            <Carousel.Item key={banner.id}>
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
    </div>
  )
}

export default React.memo(Banner)
