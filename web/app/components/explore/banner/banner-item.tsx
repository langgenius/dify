import type { Banner } from '@/models/app'
import { trackEvent } from '@/app/components/base/amplitude'

export type BannerImageState = 'active' | 'next' | 'requested' | 'deferred'

type BannerItemProps = {
  banner: Banner
  sort: number
  language: string
  accountId?: string
  titleId: string
  imageState: BannerImageState
}

const BANNER_IMAGE_WIDTH = 224
const BANNER_IMAGE_MAX_DPR_WIDTH = BANNER_IMAGE_WIDTH * 2
const CLOUDFLARE_IMAGE_PREFIX = '/cdn-cgi/image/'

function getCloudflareBannerImageUrl(imageUrl: string, width: number) {
  try {
    const url = new URL(imageUrl)
    if (url.hostname !== 'assets.dify.ai') return imageUrl

    if (url.pathname.startsWith(CLOUDFLARE_IMAGE_PREFIX)) {
      const transformedPath = url.pathname.slice(CLOUDFLARE_IMAGE_PREFIX.length)
      const optionsEnd = transformedPath.indexOf('/')
      if (optionsEnd === -1) return imageUrl

      const options = transformedPath
        .slice(0, optionsEnd)
        .split(',')
        .filter((option) => !option.startsWith('width='))
      options.push(`width=${width}`)
      url.pathname = `${CLOUDFLARE_IMAGE_PREFIX}${options.join(',')}/${transformedPath.slice(optionsEnd + 1)}`
      return url.toString()
    }

    url.pathname = `${CLOUDFLARE_IMAGE_PREFIX}quality=75,format=auto,width=${width}${url.pathname}`
    return url.toString()
  } catch {
    return imageUrl
  }
}

export function BannerItem({
  banner,
  sort,
  language,
  accountId,
  titleId,
  imageState,
}: BannerItemProps) {
  const { category, title, description, 'img-src': imgSrc } = banner.content
  const shouldLoadImage = imageState !== 'deferred'
  const responsiveImageSrc = getCloudflareBannerImageUrl(imgSrc, BANNER_IMAGE_MAX_DPR_WIDTH)
  const responsiveImageSrcSet =
    responsiveImageSrc === imgSrc
      ? undefined
      : `${getCloudflareBannerImageUrl(imgSrc, BANNER_IMAGE_WIDTH)} ${BANNER_IMAGE_WIDTH}w, ${responsiveImageSrc} ${BANNER_IMAGE_MAX_DPR_WIDTH}w`

  const handleBannerClick = () => {
    trackEvent('explore_banner_click', {
      banner_id: banner.id,
      title,
      sort,
      link: banner.link,
      page: 'explore',
      language,
      account_id: accountId,
      event_time: Date.now(),
    })
  }

  return (
    <article className="relative flex h-56 w-full items-start overflow-hidden rounded-2xl bg-components-panel-on-panel-item-bg shadow-xs after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-2xl after:content-[''] has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid @min-[996px]/banner:h-46">
      <div className="pointer-events-none relative z-20 min-w-px flex-1 self-stretch rounded-2xl py-6 pl-8">
        <div className="flex min-h-24 w-full flex-col gap-1 py-1 @min-[996px]/banner:flex-row @min-[996px]/banner:flex-wrap @min-[996px]/banner:items-end">
          <div className="flex min-w-0 flex-col pr-4 @min-[996px]/banner:max-w-170 @min-[996px]/banner:min-w-120 @min-[996px]/banner:flex-[1_0_0]">
            <p className="line-clamp-1 h-[1.8rem] w-full title-4xl-semi-bold wrap-break-word text-dify-logo-blue">
              {category}
            </p>
            <p
              id={titleId}
              className="line-clamp-2 min-h-[3.6rem] w-full title-4xl-semi-bold wrap-break-word text-dify-logo-black"
            >
              {title}
            </p>
          </div>

          <div className="flex min-w-0 items-end pr-4 @min-[996px]/banner:max-w-150 @min-[996px]/banner:min-w-60 @min-[996px]/banner:flex-[1_0_0] @min-[996px]/banner:py-1">
            <p className="line-clamp-3 min-w-0 flex-1 overflow-hidden body-sm-regular text-text-tertiary">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="pointer-events-none relative z-20 hidden w-60 max-w-60 shrink-0 flex-col items-end justify-center self-stretch p-2 @min-[720px]/banner:flex">
        {shouldLoadImage && (
          <img
            src={responsiveImageSrc}
            srcSet={responsiveImageSrcSet}
            sizes={responsiveImageSrcSet ? `${BANNER_IMAGE_WIDTH}px` : undefined}
            alt=""
            width={BANNER_IMAGE_WIDTH}
            height={168}
            loading="eager"
            fetchPriority={imageState === 'active' ? 'high' : 'low'}
            className="aspect-4/3 w-full shrink-0 rounded-xl object-cover"
          />
        )}
      </div>

      {banner.link && (
        <a
          href={banner.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-labelledby={titleId}
          className="absolute inset-0 z-10 cursor-pointer touch-manipulation rounded-2xl outline-hidden"
          onClick={handleBannerClick}
        >
          <span className="sr-only">{title}</span>
        </a>
      )}
    </article>
  )
}
