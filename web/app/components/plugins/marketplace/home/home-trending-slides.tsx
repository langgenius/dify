'use client'

import type {
  BannerAd,
  BannerBlog,
  BannerEvent,
  BannerRecommend,
  BannerRecommendCard,
  PluginBanner,
} from '@dify/contracts/marketplace'
import type { MarketplaceBannerPage } from './banners'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import { trackEvent } from '@/app/components/base/amplitude'
import Partner from '@/app/components/plugins/base/badges/partner'
import Verified from '@/app/components/plugins/base/badges/verified'
import { MARKETPLACE_API_PREFIX } from '@/config'
import Link from '@/next/link'
import {
  rememberMarketplaceSiteReferrer,
  trackMarketplaceSiteEvent,
} from '@/utils/marketplace-site-track'
import { getPluginLinkInMarketplace } from '../utils'
import background from './assets/background.webp'
import difyUpdatesArt from './assets/dify-updates-art.png'
import {
  EMBEDDED_MOBILE_BANNER_MEDIA,
  MARKETPLACE_MOBILE_BANNER_MEDIA,
  marketplaceTabletBannerMedia,
  resolveEventAdBannerImageSrcs,
} from './event-ad-banner-image'
import { buildMarketplaceBannerClickProperties } from './home-trending-track'
import styles from './home-trending.module.css'

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
  if (isMarketplacePlatform) return getLocalCardHref(card)
  if (card.link) return card.link

  // The embedded console has no local plugin detail route, so a plugin card
  // without a delivery-provided link opens the marketplace site detail page.
  if (card.item_type === 'plugin') {
    const [organization, pluginName] = card.item_id.split('/')
    if (organization && pluginName)
      return getPluginLinkInMarketplace({ org: organization, name: pluginName, type: 'plugin' })
  }

  return getLocalCardHref(card)
}

const getCardCreator = (card: BannerRecommendCard) => {
  if (card.creator) return card.creator
  if (card.item_type !== 'plugin') return ''

  return card.item_id.split('/')[0] || ''
}

const getBannerFrameProps = (banner: PluginBanner, page: MarketplaceBannerPage) => ({
  banner_id: banner.id,
  sort: banner.sort,
  page,
  language: banner.language,
  style_type: banner.style_type,
})

const trackMarketplaceBannerClick = (
  banner: PluginBanner,
  cardClick?: Parameters<typeof buildMarketplaceBannerClickProperties>[1],
) => {
  trackMarketplaceSiteEvent(
    'marketplace_banner_click',
    buildMarketplaceBannerClickProperties(banner, cardClick),
  )
}

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
        <p
          className={cn(
            styles.copyDescription,
            'w-full text-[13px] leading-5 font-normal tracking-[-0.065px] text-text-tertiary',
          )}
        >
          {description}
        </p>
      </div>
    </div>
  )
}

function TrendingCard({
  banner,
  card,
  isMarketplacePlatform,
  page,
}: {
  banner: BannerRecommend
  card: BannerRecommendCard
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
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
      onClick={() => {
        trackEvent('marketplace_banner_item_click', {
          ...getBannerFrameProps(banner, page),
          item_type: card.item_type,
          item_id: card.item_id,
          card_position: card.card_position,
          theme_type: banner.content.theme_type,
          auto_batch_id: card.auto_batch_id ?? null,
        })
        rememberMarketplaceSiteReferrer(card.item_id, 'banner')
        trackMarketplaceBannerClick(banner, {
          item_id: card.item_id,
          item_type: card.item_type,
          link: href,
        })
      }}
      className={cn(
        styles.card,
        'flex h-[116px] shrink-0 flex-col items-start justify-between overflow-hidden rounded-lg bg-background-default-dodge p-3.5 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
      )}
    >
      <div
        className={cn(
          styles.cardIcon,
          'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge',
        )}
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

      <div className={cn(styles.cardMeta, 'flex w-full items-end gap-1')}>
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
  page,
}: {
  banner: BannerRecommend
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
}) {
  return (
    <div
      className={cn(
        'flex h-[200px] w-full overflow-hidden rounded-2xl bg-background-body',
        isMarketplacePlatform && styles.stackedSlide,
      )}
    >
      <TrendingCopy banner={banner} isMarketplacePlatform={isMarketplacePlatform} />
      <div
        className={cn(
          styles.recommendVisual,
          'relative h-[200px] shrink-0 overflow-hidden rounded-xl bg-background-body',
          isMarketplacePlatform && styles.stackedVisual,
        )}
      >
        <img
          src={background.src}
          width={1600}
          height={900}
          alt=""
          aria-hidden
          className={cn(
            styles.recommendBackdrop,
            'absolute top-[-173px] left-[-990px] h-[1201px] w-[2135px] max-w-none opacity-80',
          )}
        />
        <div
          aria-hidden
          className={cn(
            styles.recommendBackdrop,
            'absolute inset-0 bg-text-accent mix-blend-color',
          )}
        />

        <div className={cn(styles.recommendCards, 'relative z-10 h-full items-center')}>
          {banner.content.cards.map((card) => (
            <TrendingCard
              key={`${card.item_type}:${card.item_id}`}
              banner={banner}
              card={card}
              isMarketplacePlatform={isMarketplacePlatform}
              page={page}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function BlogBannerSlide({
  banner,
  isMarketplacePlatform,
  page,
}: {
  banner: BannerBlog
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
}) {
  const { t } = useTranslation('plugin')
  const opensInNewTab = /^https?:\/\//.test(banner.content.link)

  return (
    <Link
      href={banner.content.link}
      target={opensInNewTab ? '_blank' : undefined}
      rel={opensInNewTab ? 'noopener noreferrer' : undefined}
      onClick={() => {
        trackEvent('marketplace_banner_click', getBannerFrameProps(banner, page))
        trackMarketplaceBannerClick(banner)
      }}
      aria-label={t(($) => $['marketplace.home.trendingReadMoreAbout'], {
        title: banner.content.blog_title,
      })}
      className={cn(
        'flex h-[200px] w-full overflow-hidden rounded-2xl bg-background-body outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        isMarketplacePlatform && styles.stackedSlide,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col items-start overflow-hidden px-6 py-5',
          isMarketplacePlatform && styles.stackedCopy,
        )}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-2">
          <div className="flex w-full items-center justify-between gap-2">
            <p className="shrink-0 rounded-sm bg-state-success-hover-alt px-1.5 py-0.5 text-[10px] leading-3 font-semibold tracking-[-0.2px] text-text-success">
              {banner.title}
            </p>
            {isMarketplacePlatform && (
              <span
                aria-hidden
                className={cn(
                  styles.readMoreMobile,
                  'shrink-0 items-center gap-1 text-[13px] leading-[normal] font-medium text-text-accent underline decoration-[10%] underline-offset-2',
                )}
              >
                <span>{t(($) => $['marketplace.home.trendingReadMore'])}</span>
                <span className="i-ri-arrow-right-s-line size-4" />
              </span>
            )}
          </div>
          <div className="flex min-h-0 w-full max-w-[800px] flex-1 flex-col items-start gap-3">
            <h2 className="shrink-0 text-xl leading-6 font-semibold tracking-[-0.4px] text-text-primary">
              {banner.content.blog_title}
            </h2>
            <div
              className={cn(
                'flex min-h-0 w-full flex-1 flex-col items-start gap-2',
                isMarketplacePlatform && styles.stackedCopyMeta,
              )}
            >
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
              <span
                aria-hidden
                className={cn(
                  'flex shrink-0 items-center gap-1 text-[13px] leading-[normal] font-medium text-text-accent underline decoration-[10%] underline-offset-2',
                  isMarketplacePlatform && styles.readMoreDesktop,
                )}
              >
                <span>{t(($) => $['marketplace.home.trendingReadMore'])}</span>
                <span className="i-ri-arrow-right-s-line size-4" />
              </span>
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
        className={cn(
          styles.updatesArt,
          isMarketplacePlatform && styles.stackedVisual,
          'h-[200px] shrink-0 object-cover',
        )}
      />
    </Link>
  )
}

function ImageBannerSlide({
  banner,
  isMarketplacePlatform,
  page,
}: {
  banner: BannerEvent | BannerAd
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
}) {
  const resolved = resolveEventAdBannerImageSrcs({
    desktop: getMarketplaceAssetURL(banner.content.images.desktop),
    tablet: getMarketplaceAssetURL(banner.content.images.tablet) || undefined,
    mobile: getMarketplaceAssetURL(banner.content.images.mobile) || undefined,
  })

  return (
    <Link
      href={banner.content.link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        trackEvent('marketplace_banner_click', getBannerFrameProps(banner, page))
        trackMarketplaceBannerClick(banner)
      }}
      aria-label={banner.content.alt_text || banner.title}
      className={cn(
        'block h-[200px] w-full overflow-hidden rounded-2xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        isMarketplacePlatform && styles.imageSlide,
      )}
    >
      <picture className="block size-full">
        <source
          media={isMarketplacePlatform ? MARKETPLACE_MOBILE_BANNER_MEDIA : EMBEDDED_MOBILE_BANNER_MEDIA}
          srcSet={resolved.mobile}
        />
        {resolved.tablet && (
          <source media={marketplaceTabletBannerMedia(isMarketplacePlatform)} srcSet={resolved.tablet} />
        )}
        <img
          src={resolved.desktop}
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

export function HomeBannerSlide({
  banner,
  isMarketplacePlatform,
  page,
}: {
  banner: PluginBanner
  isMarketplacePlatform: boolean
  page: MarketplaceBannerPage
}) {
  if (banner.style_type === 'blog')
    return (
      <BlogBannerSlide banner={banner} isMarketplacePlatform={isMarketplacePlatform} page={page} />
    )

  if (banner.style_type === 'event' || banner.style_type === 'ad')
    return (
      <ImageBannerSlide banner={banner} isMarketplacePlatform={isMarketplacePlatform} page={page} />
    )

  return (
    <TrendingRecommendationSlide
      banner={banner}
      isMarketplacePlatform={isMarketplacePlatform}
      page={page}
    />
  )
}
