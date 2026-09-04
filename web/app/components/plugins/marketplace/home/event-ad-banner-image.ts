export const MARKETPLACE_MOBILE_BANNER_MEDIA = '(max-width: 879px)'
export const EMBEDDED_MOBILE_BANNER_MEDIA = '(max-width: 639px)'

export function marketplaceTabletBannerMedia(isMarketplacePlatform: boolean) {
  return isMarketplacePlatform
    ? '(min-width: 880px) and (max-width: 1023px)'
    : '(min-width: 640px) and (max-width: 1023px)'
}

export function resolveEventAdBannerImageSrcs(images: {
  desktop: string
  tablet?: string
  mobile?: string
}) {
  return {
    desktop: images.desktop,
    // Phones always get a source: the mobile asset when present, otherwise desktop.
    // That keeps tablet from winning at mobile widths.
    mobile: images.mobile || images.desktop,
    tablet: images.tablet || undefined,
  }
}
