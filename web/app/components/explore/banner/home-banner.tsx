import { Banner } from './banner'
import { getHomeBanners } from './data'

export async function HomeBanner() {
  const banners = await getHomeBanners().catch(() => {
    // Banner data is optional; retain the greeting shell when its request fails.
    return []
  })

  return <Banner banners={banners} reserveCarouselSpace />
}
