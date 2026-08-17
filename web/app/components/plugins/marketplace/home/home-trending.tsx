'use client'

import type { PluginBanner } from '@dify/contracts/marketplace'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import TrendingNavigation from './home-trending-navigation'
import { HomeBannerSlide } from './home-trending-slides'
import styles from './home-trending.module.css'

function HomeTrending({
  banners,
  isMarketplacePlatform,
}: {
  banners: PluginBanner[]
  isMarketplacePlatform: boolean
}) {
  const { t } = useTranslation('plugin')
  const carouselRootRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isRotationPaused, setIsRotationPaused] = useState(false)
  const selectSlide = useCallback((index: number) => setSelectedIndex(index), [])
  const selectNextSlide = useCallback(
    () => setSelectedIndex((currentIndex) => (currentIndex + 1) % banners.length),
    [banners.length],
  )

  if (banners.length === 0) return null

  return (
    <section
      aria-label={t(($) => $['marketplace.home.trendingTitle'])}
      className={cn(
        'shrink-0 bg-background-default pb-6',
        isMarketplacePlatform ? 'px-4 min-[1232px]:px-0' : 'px-4 md:px-9',
      )}
    >
      <div
        className={cn(
          styles.wrapper,
          'mx-auto w-full',
          isMarketplacePlatform ? 'max-w-[1200px]' : 'max-w-[1188px]',
        )}
      >
        <div
          // The pause boundary covers the whole carousel region, so hovering
          // or focusing the navigation controls also stops the rotation.
          ref={carouselRootRef}
          role="region"
          aria-roledescription="carousel"
          aria-label={t(($) => $['marketplace.home.trendingTitle'])}
          className="relative h-[200px] w-full rounded-2xl"
          data-home-trending-carousel-root
        >
          {/* A single banner has nothing to rotate through, so skip the
              pagination/autoplay controls entirely. */}
          {banners.length > 1 && (
            <TrendingNavigation
              banners={banners}
              selectedIndex={selectedIndex}
              carouselRootRef={carouselRootRef}
              pauseWhenOffscreen={!isMarketplacePlatform}
              onSelect={selectSlide}
              onNext={selectNextSlide}
              onPausedChange={setIsRotationPaused}
            />
          )}
          <div className="h-full overflow-hidden rounded-2xl">
            <div
              // Keep automatic rotation silent for screen readers; announce
              // the current slide only once rotation is paused or user-driven.
              aria-live={isRotationPaused ? 'polite' : 'off'}
              className={cn(styles.contentTrack, 'flex h-full')}
              style={{ transform: `translate3d(-${selectedIndex * 100}%, 0, 0)` }}
            >
              {banners.map((banner, index) => {
                const isActive = index === selectedIndex

                return (
                  <div
                    key={banner.id}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={banner.title}
                    aria-hidden={!isActive}
                    inert={!isActive}
                    className="h-full min-w-0 shrink-0 grow-0 basis-full"
                  >
                    <HomeBannerSlide
                      banner={banner}
                      isMarketplacePlatform={isMarketplacePlatform}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default HomeTrending
