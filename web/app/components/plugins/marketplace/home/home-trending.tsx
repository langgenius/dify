'use client'

import type { FocusEvent } from 'react'
import type { BannerRecommend, BannerRecommendCard } from './banners'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Carousel, useCarousel } from '@/app/components/base/carousel'
import { MARKETPLACE_API_PREFIX } from '@/config'
import Link from '@/next/link'
import { cn } from '@/utils/classnames'
import background from './assets/background.jpg'
import styles from './home-trending-indicator.module.css'

const AUTOPLAY_DELAY = 5000

type TrendingIndicatorProps = {
  index: number
  label: string
  isCurrent: boolean
  isNextSlide: boolean
  isPaused: boolean
  onClick: () => void
}

const TrendingIndicator = ({
  index,
  label,
  isCurrent,
  isNextSlide,
  isPaused,
  onClick,
}: TrendingIndicatorProps) => {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={onClick}
      className="group relative flex size-6 shrink-0 items-center justify-center rounded-lg p-0 hover:bg-transparent"
    >
      <span
        className={cn(
          'relative flex h-5 w-[22px] items-center justify-center overflow-hidden rounded-[7px] p-px ring-1 ring-inset ring-divider-subtle',
          isCurrent && 'bg-text-primary ring-text-primary',
        )}
      >
        {isNextSlide && !isCurrent && !isPaused
          ? (
              <span
                data-progress-ring
                className={styles.progress}
                aria-hidden="true"
                style={{ animationDuration: `${AUTOPLAY_DELAY}ms` }}
              />
            )
          : null}
        <span className="relative z-10 flex h-[18px] w-5 items-center justify-center rounded-md bg-components-panel-on-panel-item-bg p-0.5 text-center text-[10px] font-semibold leading-3 text-text-tertiary transition-colors group-hover:text-text-secondary group-aria-[current=true]:bg-text-primary group-aria-[current=true]:text-components-panel-on-panel-item-bg">
          {String(index + 1).padStart(2, '0')}
        </span>
      </span>
    </button>
  )
}

type TrendingCopyProps = {
  banners: BannerRecommend[]
  isMarketplacePlatform: boolean
}

const TrendingCopy = ({
  banners,
  isMarketplacePlatform,
}: TrendingCopyProps) => {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()
  const [isPlaying, setIsPlaying] = useState(false)
  const shouldResumeAfterFocusRef = useRef(false)
  const nextIndex = (selectedIndex + 1) % banners.length

  const pauseRotationForFocus = () => {
    const autoplay = api?.plugins().autoplay
    if (!autoplay?.isPlaying())
      return

    shouldResumeAfterFocusRef.current = true
    autoplay.stop()
  }

  const resumeRotationAfterFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget))
      return
    if (!shouldResumeAfterFocusRef.current)
      return

    shouldResumeAfterFocusRef.current = false
    api?.plugins().autoplay?.play()
  }

  useEffect(() => {
    if (!api)
      return

    const handleAutoplayPlay = () => setIsPlaying(true)
    const handleAutoplayStop = () => setIsPlaying(false)

    // eslint-disable-next-line react/set-state-in-effect -- Embla owns this external playback state.
    setIsPlaying(api.plugins().autoplay?.isPlaying() ?? false)
    api.on('autoplay:play', handleAutoplayPlay)
    api.on('autoplay:stop', handleAutoplayStop)

    return () => {
      api.off('autoplay:play', handleAutoplayPlay)
      api.off('autoplay:stop', handleAutoplayStop)
    }
  }, [api])

  return (
    <div
      className={cn(
        'relative flex h-[200px] w-full flex-col gap-2.5 overflow-hidden bg-background-body p-4',
        isMarketplacePlatform
          ? 'min-[1232px]:absolute min-[1232px]:right-full min-[1232px]:top-0 min-[1232px]:w-[443px]'
          : 'min-[1260px]:absolute min-[1260px]:right-full min-[1260px]:top-0 min-[1260px]:w-[431px]',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-start gap-2 overflow-hidden">
        <p className="shrink-0 text-[10px] font-semibold leading-3 tracking-[-0.2px] text-text-accent">
          {t('marketplace.home.trendingEyebrow', { ns: 'plugin' })}
        </p>
        <h2
          id="home-trending-title"
          className="shrink-0 text-xl font-semibold leading-6 tracking-[-0.4px] text-text-primary"
        >
          {t('marketplace.home.trendingTitle', { ns: 'plugin' })}
        </h2>
        <p className="text-[13px] font-normal leading-5 tracking-[-0.065px] text-text-tertiary">
          {t('marketplace.home.trendingDescription', { ns: 'plugin' })}
        </p>
      </div>

      <div
        role="group"
        aria-label={t('marketplace.home.trendingPaginationLabel', { ns: 'plugin' })}
        className="flex shrink-0 items-center py-1 pr-10"
        onFocusCapture={pauseRotationForFocus}
        onBlurCapture={resumeRotationAfterFocus}
      >
        <div className="flex items-center gap-0.5">
          {banners.map((banner, index) => (
            <TrendingIndicator
              key={banner.id}
              index={index}
              label={`${String(index + 1).padStart(2, '0')} ${banner.title}`}
              isCurrent={index === selectedIndex}
              isNextSlide={index === nextIndex}
              isPaused={!isPlaying}
              onClick={() => api?.scrollTo(index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const getMarketplaceAssetURL = (path?: string) => {
  if (!path)
    return ''
  if (/^https?:\/\//.test(path))
    return path

  try {
    const apiURL = new URL(MARKETPLACE_API_PREFIX)
    if (path.startsWith('/api/'))
      return `${apiURL.origin}${path}`
    return `${MARKETPLACE_API_PREFIX.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  }
  catch {
    return path
  }
}

const getLocalCardHref = (card: BannerRecommendCard) => {
  if (card.item_type === 'plugin') {
    const [organization, pluginName] = card.item_id.split('/')
    if (organization && pluginName)
      return `/plugin/${encodeURIComponent(organization)}/${encodeURIComponent(pluginName)}`
  }

  if (card.item_type === 'template')
    return `/templates?tid=${encodeURIComponent(card.item_id)}`

  return '/'
}

const getCardHref = (
  card: BannerRecommendCard,
  isMarketplacePlatform: boolean,
) => {
  if (!isMarketplacePlatform && card.link)
    return card.link
  return getLocalCardHref(card)
}

const getCardCreator = (card: BannerRecommendCard) => {
  if (card.item_type !== 'plugin')
    return ''

  return card.item_id.split('/')[0] || ''
}

type TrendingCardProps = {
  card: BannerRecommendCard
  isMarketplacePlatform: boolean
}

const TrendingCard = ({
  card,
  isMarketplacePlatform,
}: TrendingCardProps) => {
  const { t } = useTranslation()
  const iconURL = getMarketplaceAssetURL(card.icon_url)
  const creator = getCardCreator(card)
  const href = getCardHref(card, isMarketplacePlatform)
  const opensInNewTab = !isMarketplacePlatform && /^https?:\/\//.test(href)

  return (
    <Link
      href={href}
      target={opensInNewTab ? '_blank' : undefined}
      rel={opensInNewTab ? 'noopener noreferrer' : undefined}
      aria-label={card.display_name}
      className="relative flex h-[116px] w-[161px] shrink-0 flex-col items-start overflow-hidden rounded-lg bg-components-panel-on-panel-item-bg-transparent p-3.5 shadow-md backdrop-blur-md"
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge bg-cover bg-center bg-no-repeat"
        style={{
          backgroundColor: !iconURL ? card.icon_background : undefined,
          backgroundImage: iconURL ? `url(${iconURL})` : undefined,
        }}
      >
        {!iconURL && card.icon
          ? <span className="text-xl leading-none">{card.icon}</span>
          : null}
        {!iconURL && !card.icon
          ? <span aria-hidden="true" className="i-ri-image-line size-5 text-text-quaternary" />
          : null}
      </div>

      <h3 className="mt-3 w-full truncate text-sm font-medium leading-[normal] text-text-primary">
        {card.display_name}
      </h3>
      {creator
        ? (
            <p className="mt-[3px] w-full truncate text-xs font-normal leading-[normal] text-text-tertiary">
              {t('marketplace.home.trendingByCreator', { ns: 'plugin', creator })}
            </p>
          )
        : null}

      <span
        aria-hidden="true"
        className="i-ri-arrow-right-up-line absolute right-2 top-1.5 size-4 text-text-quaternary"
      />
    </Link>
  )
}

type TrendingSlideProps = {
  banner: BannerRecommend
  isMarketplacePlatform: boolean
}

const TrendingSlide = ({
  banner,
  isMarketplacePlatform,
}: TrendingSlideProps) => {
  return (
    <div className="relative h-[200px] w-full overflow-hidden rounded-xl bg-text-accent">
      <img
        src={background.src}
        width={3840}
        height={2160}
        alt=""
        aria-hidden
        className="absolute left-[-990px] top-[-173px] h-[1201px] w-[2135px] max-w-none opacity-80"
      />
      <div aria-hidden className="absolute inset-0 bg-text-accent mix-blend-color" />

      <div className="relative z-10 flex h-full items-center justify-between px-9 py-[42px]">
        {banner.content.cards.map(card => (
          <TrendingCard
            key={`${card.item_type}:${card.item_id}`}
            card={card}
            isMarketplacePlatform={isMarketplacePlatform}
          />
        ))}
      </div>
    </div>
  )
}

type HomeTrendingProps = {
  banners: BannerRecommend[]
  isMarketplacePlatform: boolean
}

const HomeTrending = ({
  banners,
  isMarketplacePlatform,
}: HomeTrendingProps) => {
  const { t } = useTranslation()
  const [carouselPlugins] = useState(() => [
    Carousel.Plugin.Autoplay({
      delay: AUTOPLAY_DELAY,
      stopOnFocusIn: true,
      stopOnInteraction: false,
      stopOnMouseEnter: true,
      breakpoints: {
        '(prefers-reduced-motion: reduce)': { active: false },
      },
    }),
  ])

  if (banners.length === 0)
    return null

  return (
    <section
      aria-labelledby="home-trending-title"
      className={cn(
        'shrink-0 bg-background-default pb-6',
        isMarketplacePlatform
          ? 'px-4 min-[1232px]:px-0'
          : 'px-4 md:px-9',
      )}
    >
      <div
        className={cn(
          'mx-auto w-full overflow-hidden rounded-xl bg-background-body',
          isMarketplacePlatform ? 'max-w-[1200px]' : 'max-w-[1188px]',
        )}
      >
        <Carousel
          opts={{ loop: true }}
          plugins={carouselPlugins}
          overlay={(
            <TrendingCopy
              banners={banners}
              isMarketplacePlatform={isMarketplacePlatform}
            />
          )}
          aria-label={t('marketplace.home.trendingTitle', { ns: 'plugin' })}
          className={cn(
            'ml-auto w-full rounded-xl',
            isMarketplacePlatform
              ? 'min-[1232px]:w-[757px]'
              : 'min-[1260px]:w-[757px]',
          )}
        >
          <Carousel.Content aria-live="polite" className="rounded-xl">
            {banners.map(banner => (
              <Carousel.Item key={banner.id}>
                <TrendingSlide
                  banner={banner}
                  isMarketplacePlatform={isMarketplacePlatform}
                />
              </Carousel.Item>
            ))}
          </Carousel.Content>
        </Carousel>
      </div>
    </section>
  )
}

export default HomeTrending
