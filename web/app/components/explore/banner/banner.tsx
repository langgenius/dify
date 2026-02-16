import type { FC } from 'react'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Carousel } from '@/app/components/base/carousel'
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
  const [isHovered, setIsHovered] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const resizeTimerRef = useRef<NodeJS.Timeout | null>(null)

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
        {enabledBanners.map(banner => (
          <Carousel.Item key={banner.id}>
            <BannerItem
              banner={banner}
              autoplayDelay={AUTOPLAY_DELAY}
              isPaused={isPaused}
            />
          </Carousel.Item>
        ))}
      </Carousel.Content>
    </Carousel>
  )
}

export default React.memo(Banner)
