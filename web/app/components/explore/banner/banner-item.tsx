import type { Banner } from '@/models/app'
import { useId } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'

type BannerItemProps = {
  banner: Banner
  sort: number
  language: string
  accountId?: string
}

export function BannerItem({ banner, sort, language, accountId }: BannerItemProps) {
  const titleId = useId()
  const { category, title, description, 'img-src': imgSrc } = banner.content

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
    <article className="relative flex h-[224px] w-full items-start overflow-hidden rounded-2xl bg-components-panel-on-panel-item-bg shadow-xs after:pointer-events-none after:absolute after:inset-0 after:z-30 after:rounded-2xl after:content-[''] has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid @min-[996px]/banner:h-[184px]">
      <div className="pointer-events-none relative z-20 min-w-px flex-1 self-stretch rounded-2xl py-6 pl-8">
        <div className="flex min-h-24 w-full flex-col gap-1 py-1 @min-[996px]/banner:flex-row @min-[996px]/banner:flex-wrap @min-[996px]/banner:items-end">
          <div className="flex min-w-0 flex-col pr-4 @min-[996px]/banner:max-w-[680px] @min-[996px]/banner:min-w-[480px] @min-[996px]/banner:flex-[1_0_0]">
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

          <div className="min-w-0 overflow-hidden pr-4 @min-[996px]/banner:max-w-[600px] @min-[996px]/banner:min-w-60 @min-[996px]/banner:flex-[1_0_0] @min-[996px]/banner:self-end @min-[996px]/banner:py-1">
            <p className="line-clamp-3 overflow-hidden body-sm-regular text-text-tertiary">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="pointer-events-none relative z-20 hidden w-60 max-w-60 shrink-0 flex-col items-end justify-center self-stretch p-2 @min-[720px]/banner:flex">
        <img
          src={imgSrc}
          alt=""
          width={224}
          height={168}
          className="aspect-4/3 w-full shrink-0 rounded-xl object-cover"
        />
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
