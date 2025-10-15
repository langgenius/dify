import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { Carousel } from '@/app/components/base/carousel'
import { useGetBanners } from '@/service/use-explore'
import Loading from '../../base/loading'
import { type BannerData, BannerItem } from './banner-item'
import { useI18N } from '@/context/i18n'

const AUTOPLAY_DELAY = 5000
const MIN_LOADING_HEIGHT = 168

const Banner: FC = () => {
  const { locale } = useI18N()
  const { data: banners, isLoading, isError } = useGetBanners(locale)
  const [isHovered, setIsHovered] = useState(false)

  const enabledBanners = useMemo(
    () => banners?.filter((banner: BannerData) => banner.status === 'enabled') ?? [],
    [banners],
  )

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl bg-components-panel-on-panel-item-bg shadow-md"
        style={{ minHeight: MIN_LOADING_HEIGHT }}
      >
        <Loading />
      </div>
    )
  }

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
        {enabledBanners.map((banner: BannerData) => (
          <Carousel.Item key={banner.id}>
            <BannerItem banner={banner} autoplayDelay={AUTOPLAY_DELAY} isPaused={isHovered} />
          </Carousel.Item>
        ))}
      </Carousel.Content>
    </Carousel>
  )
}

export default React.memo(Banner)
