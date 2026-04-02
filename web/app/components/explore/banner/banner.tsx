import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { Carousel } from '@/app/components/base/carousel'
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
    className="flex items-center justify-center rounded-2xl bg-components-panel-on-panel-item-bg shadow-md"
    style={{ minHeight: MIN_LOADING_HEIGHT }}
  >
    <Loading />
  </div>
)

const Banner: FC = () => {
  const locale = useLocale()
  const { data: banners, isLoading, isError } = useGetBanners(locale)
  const accountId = useSelector(s => s.userProfile.id)
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

  useEffect(() => {
    if (!accountId)
      return

    enabledBanners.forEach((banner, index) => {
      if (trackedBannerIdsRef.current.has(banner.id))
        return

      trackEvent('explore_banner_impression', {
        banner_id: banner.id,
        title: banner.content.title,
        sort: index + 1,
        link: banner.link,
        page: 'explore',
        language: locale,
        account_id: accountId,
        event_time: Date.now(),
      })
      trackedBannerIdsRef.current.add(banner.id)
    })
  }, [accountId, enabledBanners, locale])

  if (isLoading)
    return <LoadingState />

  if (isError || enabledBanners.length === 0)
    return null

  return (
    <Carousel
      opts={{ loop: true }}
      plugins={[
        Carousel.Plugin.Autoplay({
          delay: AUTOPLAY_DELAY,
          stopOnInteraction: false,
          stopOnMouseEnter: true,
        }),
      ]}
      className="rounded-2xl"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
  )
}

export default React.memo(Banner)
