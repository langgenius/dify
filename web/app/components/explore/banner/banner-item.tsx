import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { RiArrowRightLine } from '@remixicon/react'
import { useCarousel } from '@/app/components/base/carousel'
import { IndicatorButton } from './indicator-button'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

export type BannerData = {
  id: string
  content: {
    'category': string
    'title': string
    'description': string
    'img-src': string
  }
  status: 'enabled' | 'disabled'
  link: string
  created_at: number
}

type BannerItemProps = {
  banner: BannerData
  autoplayDelay: number
}

export const BannerItem: FC<BannerItemProps> = ({ banner, autoplayDelay }) => {
  const { t } = useTranslation()
  const { api, selectedIndex } = useCarousel()

  const slideInfo = useMemo(() => {
    const slides = api?.slideNodes() ?? []
    const totalSlides = slides.length
    const nextIndex = totalSlides > 0 ? (selectedIndex + 1) % totalSlides : 0
    return { slides, totalSlides, nextIndex }
  }, [api, selectedIndex])

  const handleClick = useCallback(() => {
    if (banner.link)
      window.open(banner.link, '_blank', 'noopener,noreferrer')
  }, [banner.link])

  return (
    <div
      className={cn(
        'relative flex w-full cursor-pointer items-start overflow-hidden rounded-2xl bg-components-panel-on-panel-item-bg shadow-md transition-shadow',
        'hover:shadow-lg',
      )}
      onClick={handleClick}
    >
      {/* Left content area */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-3 py-6 pl-8 pr-0">
          {/* Text section */}
          <div className="flex min-h-24 flex-wrap items-end gap-1 py-1">
            {/* Title area */}
            <div className="flex min-w-[480px] max-w-[680px] flex-[1_0_0] flex-col pr-4">
              <p className="title-4xl-semi-bold line-clamp-1 text-dify-logo-dify-logo-blue">
                {banner.content.category}
              </p>
              <p className="title-4xl-semi-bold line-clamp-2 text-dify-logo-dify-logo-black">
                {banner.content.title}
              </p>
            </div>
            {/* Description area */}
            <div className="body-sm-regular line-clamp-4 min-w-60 max-w-[600px] flex-[1_0_0] self-end py-1 pr-4 text-text-tertiary">
              {banner.content.description}
            </div>
          </div>

          {/* Actions section */}
          <div className="flex flex-wrap items-center gap-1">
            {/* View more button */}
            <div className="flex min-w-[480px] max-w-[680px] flex-[1_0_0] items-center gap-[6px] py-1">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-text-accent p-[2px]">
                <RiArrowRightLine className="h-3 w-3 text-text-primary-on-surface" />
              </div>
              <span className="system-sm-semibold-uppercase text-text-accent">
                {t('explore.banner.viewMore')}
              </span>
            </div>

            {/* Slide navigation indicators */}
            <div className="flex min-w-60 max-w-[600px] flex-[1_0_0] items-center gap-2 py-1 pr-10">
              {slideInfo.slides.map((_: unknown, index: number) => (
                <IndicatorButton
                  key={index}
                  index={index}
                  selectedIndex={selectedIndex}
                  isNextSlide={index === slideInfo.nextIndex}
                  autoplayDelay={autoplayDelay}
                  onClick={() => api?.scrollTo(index)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right image area */}
      <div className="flex w-[296px] shrink-0 items-stretch self-stretch p-2">
        <img
          src={banner.content['img-src']}
          alt={banner.content.title}
          className="h-full w-full rounded-xl object-cover"
        />
      </div>
    </div>
  )
}
