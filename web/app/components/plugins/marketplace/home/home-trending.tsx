'use client'

import type { RefObject } from 'react'
import type {
  BannerAd,
  BannerBlog,
  BannerEvent,
  BannerRecommend,
  BannerRecommendCard,
  PluginBanner,
} from './banners'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '#i18n'
import Partner from '@/app/components/plugins/base/badges/partner'
import Verified from '@/app/components/plugins/base/badges/verified'
import { MARKETPLACE_API_PREFIX } from '@/config'
import Link from '@/next/link'
import background from './assets/background.jpg'
import difyUpdatesArt from './assets/dify-updates-art.png'
import styles from './home-trending.module.css'

const AUTOPLAY_DELAY = 5000
const PAGINATION_DOT_SIZE = 6
const PAGINATION_ACTIVE_WIDTH = 40
const PAGINATION_GAP = 8
const PAGINATION_STEP = PAGINATION_DOT_SIZE + PAGINATION_GAP
const PAGINATION_ACTIVE_SHIFT = PAGINATION_ACTIVE_WIDTH - PAGINATION_DOT_SIZE

const getPaginationItemOffset = (index: number, selectedIndex: number) =>
  index * PAGINATION_STEP + (index > selectedIndex ? PAGINATION_ACTIVE_SHIFT : 0)

type AutoplayPauseReason = 'focus' | 'hover' | 'reduced-motion' | 'user' | 'viewport' | 'visibility'

function TrendingCopy({
  banner,
  isMarketplacePlatform,
}: {
  banner: BannerRecommend
  isMarketplacePlatform: boolean
}) {
  const { t } = useTranslation('plugin')
  const heading = banner.content.heading || t(($) => $['marketplace.home.trendingTitle'])
  const description =
    banner.content.description ||
    banner.content.subheadings?.join(' · ') ||
    t(($) => $['marketplace.home.trendingDescription'])

  return (
    <div
      className={cn(
        styles.copy,
        'flex min-w-0 flex-col items-start overflow-hidden p-5',
        isMarketplacePlatform ? styles.marketplaceCopy : styles.embeddedCopy,
      )}
    >
      <div className="flex w-full flex-col items-start gap-2 overflow-hidden">
        <p className="shrink-0 rounded-sm bg-state-accent-hover-alt px-1.5 py-0.5 text-[10px] leading-3 font-semibold tracking-[-0.2px] text-text-accent">
          {banner.title}
        </p>
        <h2 className="shrink-0 text-xl leading-6 font-semibold tracking-[-0.4px] text-text-primary">
          {heading}
        </h2>
        <p className="w-full text-[13px] leading-5 font-normal tracking-[-0.065px] text-text-tertiary">
          {description}
        </p>
      </div>
    </div>
  )
}

const getMarketplaceAssetURL = (path?: string) => {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('/_next/')) return path

  try {
    const apiURL = new URL(MARKETPLACE_API_PREFIX)
    if (path.startsWith('/api/')) return `${apiURL.origin}${path}`
    return `${MARKETPLACE_API_PREFIX.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  } catch {
    return path
  }
}

const getLocalCardHref = (card: BannerRecommendCard) => {
  if (card.item_type === 'plugin') {
    const [organization, pluginName] = card.item_id.split('/')
    if (organization && pluginName)
      return `/plugin/${encodeURIComponent(organization)}/${encodeURIComponent(pluginName)}`
  }

  if (card.item_type === 'template') return `/templates?tid=${encodeURIComponent(card.item_id)}`

  return '/'
}

const getCardHref = (card: BannerRecommendCard, isMarketplacePlatform: boolean) => {
  if (!isMarketplacePlatform && card.link) return card.link
  return getLocalCardHref(card)
}

const getCardCreator = (card: BannerRecommendCard) => {
  if (card.creator) return card.creator
  if (card.item_type !== 'plugin') return ''

  return card.item_id.split('/')[0] || ''
}

function TrendingCard({
  card,
  isMarketplacePlatform,
}: {
  card: BannerRecommendCard
  isMarketplacePlatform: boolean
}) {
  const { t } = useTranslation('plugin')
  const iconURL = getMarketplaceAssetURL(card.icon_url)
  const creator = getCardCreator(card)
  const href = getCardHref(card, isMarketplacePlatform)
  const opensInNewTab = !isMarketplacePlatform && /^https?:\/\//.test(href)
  const isPartner = card.badges?.includes('partner')
  const isVerified = card.badges?.includes('verified')

  return (
    <Link
      href={href}
      target={opensInNewTab ? '_blank' : undefined}
      rel={opensInNewTab ? 'noopener noreferrer' : undefined}
      aria-label={card.display_name}
      className={cn(
        styles.card,
        'flex h-[116px] shrink-0 flex-col items-start justify-between overflow-hidden rounded-lg bg-background-default-dodge p-3.5 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
      )}
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge"
        style={{
          backgroundColor: !iconURL ? card.icon_background : undefined,
        }}
      >
        {iconURL ? (
          <img
            src={iconURL}
            width={40}
            height={40}
            alt=""
            aria-hidden
            className="size-full object-cover"
          />
        ) : card.icon ? (
          <span className="text-xl leading-none">{card.icon}</span>
        ) : (
          <span aria-hidden="true" className="i-ri-image-line size-5 text-text-quaternary" />
        )}
      </div>

      <div className="flex w-full items-end gap-1">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-[3px]">
          <div className="flex w-full min-w-0 items-center gap-[3px]">
            <h3 className="min-w-0 truncate text-sm leading-[normal] font-medium text-text-primary">
              {card.display_name}
            </h3>
            {(isPartner || isVerified) && (
              <div className="flex shrink-0 items-start gap-[3.5px]">
                {isPartner && (
                  <Partner className="size-3.5" text={t(($) => $['marketplace.partnerTip'])} />
                )}
                {isVerified && (
                  <Verified className="size-3.5" text={t(($) => $['marketplace.verifiedTip'])} />
                )}
              </div>
            )}
          </div>
          {creator && (
            <p className="w-full truncate text-xs leading-[normal] font-normal text-text-tertiary">
              {t(($) => $['marketplace.home.trendingByCreator'], { creator })}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-background-section-burn px-1.5 py-[3px] text-[10px] leading-3 font-normal text-text-primary">
          {t(($) => $['marketplace.home.trendingView'])}
        </span>
      </div>
    </Link>
  )
}

function TrendingRecommendationSlide({
  banner,
  isMarketplacePlatform,
}: {
  banner: BannerRecommend
  isMarketplacePlatform: boolean
}) {
  return (
    <div
      className={cn(
        styles.recommendSlide,
        'flex h-[200px] w-full overflow-hidden rounded-2xl bg-background-body',
      )}
    >
      <TrendingCopy banner={banner} isMarketplacePlatform={isMarketplacePlatform} />
      <div
        className={cn(
          styles.recommendVisual,
          'relative h-[200px] shrink-0 overflow-hidden rounded-xl bg-background-body',
        )}
      >
        <img
          src={background.src}
          width={3840}
          height={2160}
          alt=""
          aria-hidden
          className="absolute top-[-173px] left-[-990px] h-[1201px] w-[2135px] max-w-none opacity-80"
        />
        <div aria-hidden className="absolute inset-0 bg-text-accent mix-blend-color" />

        <div className={cn(styles.recommendCards, 'relative z-10 h-full items-center')}>
          {banner.content.cards.map((card) => (
            <TrendingCard
              key={`${card.item_type}:${card.item_id}`}
              card={card}
              isMarketplacePlatform={isMarketplacePlatform}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function BlogBannerSlide({ banner }: { banner: BannerBlog }) {
  const opensInNewTab = /^https?:\/\//.test(banner.content.link)

  return (
    <div className="flex h-[200px] w-full overflow-hidden rounded-2xl bg-background-body">
      <div className="flex min-w-0 flex-1 flex-col items-start overflow-hidden px-6 py-5">
        <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-2">
          <p className="shrink-0 rounded-sm bg-state-success-hover-alt px-1.5 py-0.5 text-[10px] leading-3 font-semibold tracking-[-0.2px] text-text-success">
            {banner.title}
          </p>
          <div className="flex min-h-0 w-full max-w-[800px] flex-1 flex-col items-start gap-3">
            <h2 className="shrink-0 text-xl leading-6 font-semibold tracking-[-0.4px] text-text-primary">
              {banner.content.blog_title}
            </h2>
            <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-2">
              {banner.content.subtitle && (
                <p className="shrink-0 text-[15px] leading-[18px] font-normal tracking-[-0.3px] text-text-primary">
                  {banner.content.subtitle}
                </p>
              )}
              {banner.content.description && (
                <p className="min-h-0 w-full flex-1 overflow-hidden text-[13px] leading-5 font-normal tracking-[-0.065px] text-text-tertiary">
                  <span className={styles.updatesDescription}>{banner.content.description}</span>
                </p>
              )}
              <Link
                href={banner.content.link}
                target={opensInNewTab ? '_blank' : undefined}
                rel={opensInNewTab ? 'noopener noreferrer' : undefined}
                aria-label={`Read more about ${banner.content.blog_title}`}
                className="flex shrink-0 items-center gap-1 text-[13px] leading-[normal] font-medium text-text-accent underline decoration-[10%] underline-offset-2"
              >
                <span>Read more</span>
                <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
      <img
        src={difyUpdatesArt.src}
        width={400}
        height={200}
        alt=""
        aria-hidden
        className={cn(styles.updatesArt, 'h-[200px] shrink-0 object-cover')}
      />
    </div>
  )
}

function ImageBannerSlide({ banner }: { banner: BannerEvent | BannerAd }) {
  const desktopImage = getMarketplaceAssetURL(banner.content.images.desktop)
  const tabletImage = getMarketplaceAssetURL(banner.content.images.tablet)
  const mobileImage = getMarketplaceAssetURL(banner.content.images.mobile)

  return (
    <Link
      href={banner.content.link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={banner.content.alt_text || banner.title}
      className="block h-[200px] w-full overflow-hidden rounded-2xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
    >
      <picture className="block size-full">
        {mobileImage && <source media="(max-width: 639px)" srcSet={mobileImage} />}
        {tabletImage && <source media="(max-width: 1023px)" srcSet={tabletImage} />}
        <img
          src={desktopImage}
          width={1200}
          height={200}
          alt=""
          aria-hidden
          className="size-full object-cover"
        />
      </picture>
    </Link>
  )
}

function HomeBannerSlide({
  banner,
  isMarketplacePlatform,
}: {
  banner: PluginBanner
  isMarketplacePlatform: boolean
}) {
  if (banner.style_type === 'blog') return <BlogBannerSlide banner={banner} />

  if (banner.style_type === 'event' || banner.style_type === 'ad')
    return <ImageBannerSlide banner={banner} />

  return (
    <TrendingRecommendationSlide banner={banner} isMarketplacePlatform={isMarketplacePlatform} />
  )
}

function TrendingNavigation({
  banners,
  selectedIndex,
  carouselRootRef,
  pauseWhenOffscreen,
  onSelect,
  onNext,
}: {
  banners: PluginBanner[]
  selectedIndex: number
  carouselRootRef: RefObject<HTMLDivElement | null>
  pauseWhenOffscreen: boolean
  onSelect: (index: number) => void
  onNext: () => void
}) {
  const { t } = useTranslation('plugin')
  const progressRef = useRef<HTMLSpanElement>(null)
  const progressAnimationRef = useRef<Animation | null>(null)
  const pauseReasonsRef = useRef(
    new Set<AutoplayPauseReason>(pauseWhenOffscreen ? ['viewport'] : []),
  )
  const [isUserPaused, setIsUserPaused] = useState(false)
  const [isReducedMotionPaused, setIsReducedMotionPaused] = useState(false)
  const isExplicitlyPaused = isUserPaused || isReducedMotionPaused
  const paginationWidth =
    PAGINATION_ACTIVE_WIDTH + Math.max(0, banners.length - 1) * PAGINATION_STEP

  const setPauseReason = useCallback((reason: AutoplayPauseReason, shouldPause: boolean) => {
    if (shouldPause) pauseReasonsRef.current.add(reason)
    else pauseReasonsRef.current.delete(reason)

    const progressAnimation = progressAnimationRef.current
    if (!progressAnimation) return

    if (pauseReasonsRef.current.size > 0) progressAnimation.pause()
    else progressAnimation.play()
  }, [])

  useEffect(() => {
    const progressElement = progressRef.current
    if (!progressElement?.animate) return

    const progressAnimation = progressElement.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      {
        duration: AUTOPLAY_DELAY,
        easing: 'linear',
        fill: 'forwards',
      },
    )
    progressAnimationRef.current = progressAnimation

    if (pauseReasonsRef.current.size > 0) progressAnimation.pause()
    progressAnimation.onfinish = onNext

    return () => {
      progressAnimation.onfinish = null
      progressAnimation.cancel()
      if (progressAnimationRef.current === progressAnimation) progressAnimationRef.current = null
    }
  }, [onNext, selectedIndex])

  useEffect(() => {
    const carouselRoot = carouselRootRef.current
    if (!carouselRoot) return

    const handleMouseEnter = () => setPauseReason('hover', true)
    const handleMouseLeave = () => setPauseReason('hover', false)
    const handleFocusIn = () => setPauseReason('focus', true)
    const handleFocusOut = (event: FocusEvent) => {
      if (carouselRoot.contains(event.relatedTarget as Node | null)) return
      setPauseReason('focus', false)
    }
    const handleVisibilityChange = () =>
      setPauseReason('visibility', document.visibilityState === 'hidden')

    carouselRoot.addEventListener('mouseenter', handleMouseEnter)
    carouselRoot.addEventListener('mouseleave', handleMouseLeave)
    carouselRoot.addEventListener('focusin', handleFocusIn)
    carouselRoot.addEventListener('focusout', handleFocusOut)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    handleVisibilityChange()

    return () => {
      carouselRoot.removeEventListener('mouseenter', handleMouseEnter)
      carouselRoot.removeEventListener('mouseleave', handleMouseLeave)
      carouselRoot.removeEventListener('focusin', handleFocusIn)
      carouselRoot.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [carouselRootRef, setPauseReason])

  useEffect(() => {
    if (!pauseWhenOffscreen) {
      setPauseReason('viewport', false)
      return
    }

    const carouselRoot = carouselRootRef.current
    if (!carouselRoot) return

    if (typeof IntersectionObserver === 'undefined') {
      setPauseReason('viewport', false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = !!entry?.isIntersecting && entry.intersectionRatio >= 0.25
        setPauseReason('viewport', !isVisible)
      },
      {
        root: document.getElementById('marketplace-container'),
        threshold: 0.25,
      },
    )

    observer.observe(carouselRoot)

    return () => observer.disconnect()
  }, [carouselRootRef, pauseWhenOffscreen, setPauseReason])

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncReducedMotion = () => {
      // oxlint-disable-next-line eslint-react/set-state-in-effect -- This state mirrors an external media query.
      setIsReducedMotionPaused(reducedMotionQuery.matches)
      setPauseReason('reduced-motion', reducedMotionQuery.matches)
    }

    syncReducedMotion()
    reducedMotionQuery.addEventListener('change', syncReducedMotion)

    return () => reducedMotionQuery.removeEventListener('change', syncReducedMotion)
  }, [setPauseReason])

  const toggleAutoplay = () => {
    if (isExplicitlyPaused) {
      setIsUserPaused(false)
      setIsReducedMotionPaused(false)
      setPauseReason('user', false)
      setPauseReason('reduced-motion', false)
      return
    }

    setIsUserPaused(true)
    setPauseReason('user', true)
  }

  return (
    <div
      role="group"
      aria-label={t(($) => $['marketplace.home.trendingPaginationLabel'])}
      className={cn(
        styles.navigation,
        'absolute right-0 z-10 flex h-[22px] items-center gap-2 px-5 py-2',
      )}
    >
      <div className="relative h-1.5 shrink-0" style={{ width: paginationWidth }}>
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-1 flex h-1.5 w-10 items-center overflow-hidden rounded-full bg-state-base-handle transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
          style={{
            transform: `translate3d(${selectedIndex * PAGINATION_STEP}px, 0, 0)`,
          }}
        >
          <span
            key={selectedIndex}
            ref={progressRef}
            data-carousel-progress
            className="h-full w-full rounded-full bg-text-accent"
            style={{ transform: 'scaleX(0)', transformOrigin: 'left center' }}
          />
        </span>
        {banners.map((banner, index) => {
          const isCurrent = index === selectedIndex

          return (
            <button
              key={banner.id}
              type="button"
              aria-label={banner.title}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => {
                if (isCurrent) return
                onSelect(index)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if (isCurrent) return
                onSelect(index)
              }}
              className={cn(
                'absolute top-0 left-0 z-2 h-1.5 overflow-hidden rounded-full outline-hidden transition-[transform,width,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] after:absolute after:-inset-2 hover:bg-state-base-handle-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid motion-reduce:transition-none',
                isCurrent ? 'bg-transparent' : 'bg-state-base-handle',
              )}
              style={{
                width: isCurrent ? PAGINATION_ACTIVE_WIDTH : PAGINATION_DOT_SIZE,
                transform: `translate3d(${getPaginationItemOffset(index, selectedIndex)}px, 0, 0)`,
              }}
            />
          )
        })}
      </div>
      <div className="min-w-0 flex-1" />
      <button
        type="button"
        aria-label={t(
          ($) =>
            $[
              isExplicitlyPaused
                ? 'marketplace.home.trendingPlay'
                : 'marketplace.home.trendingPause'
            ],
        )}
        onClick={toggleAutoplay}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          toggleAutoplay()
        }}
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-state-base-handle text-text-primary outline-hidden hover:bg-state-base-handle-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        {isExplicitlyPaused ? (
          <span aria-hidden className="i-ri-play-large-fill size-2 opacity-30" />
        ) : (
          <span aria-hidden className="i-ri-pause-large-fill size-2 opacity-30" />
        )}
      </button>
    </div>
  )
}

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
          role="region"
          aria-roledescription="carousel"
          aria-label={t(($) => $['marketplace.home.trendingTitle'])}
          className="relative h-[200px] w-full rounded-2xl"
        >
          <TrendingNavigation
            banners={banners}
            selectedIndex={selectedIndex}
            carouselRootRef={carouselRootRef}
            pauseWhenOffscreen={!isMarketplacePlatform}
            onSelect={selectSlide}
            onNext={selectNextSlide}
          />
          <div
            ref={carouselRootRef}
            className="h-full overflow-hidden rounded-2xl"
            data-home-trending-carousel-root
          >
            <div
              aria-live="polite"
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
