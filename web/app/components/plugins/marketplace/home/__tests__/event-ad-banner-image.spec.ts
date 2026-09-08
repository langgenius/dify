import { describe, expect, it } from 'vitest'
import {
  EMBEDDED_MOBILE_BANNER_MEDIA,
  MARKETPLACE_MOBILE_BANNER_MEDIA,
  marketplaceTabletBannerMedia,
  resolveEventAdBannerImageSrcs,
} from '../event-ad-banner-image'

describe('resolveEventAdBannerImageSrcs', () => {
  it('uses the mobile asset on the mobile slot when one exists', () => {
    expect(
      resolveEventAdBannerImageSrcs({
        desktop: '/desktop.png',
        tablet: '/tablet.png',
        mobile: '/mobile.png',
      }),
    ).toEqual({
      desktop: '/desktop.png',
      mobile: '/mobile.png',
      tablet: '/tablet.png',
    })
  })

  it('falls back to desktop on the mobile slot when mobile is missing', () => {
    expect(
      resolveEventAdBannerImageSrcs({
        desktop: '/desktop.png',
        tablet: '/tablet.png',
      }),
    ).toEqual({
      desktop: '/desktop.png',
      mobile: '/desktop.png',
      tablet: '/tablet.png',
    })
  })

  it('omits tablet when the banner has no tablet asset', () => {
    expect(
      resolveEventAdBannerImageSrcs({
        desktop: '/desktop.png',
        mobile: '/mobile.png',
      }),
    ).toEqual({
      desktop: '/desktop.png',
      mobile: '/mobile.png',
      tablet: undefined,
    })
  })
})

describe('marketplaceTabletBannerMedia', () => {
  it('keeps tablet out of the standalone mobile breakpoint', () => {
    expect(MARKETPLACE_MOBILE_BANNER_MEDIA).toBe('(max-width: 879px)')
    expect(marketplaceTabletBannerMedia(true)).toBe('(min-width: 880px) and (max-width: 1023px)')
  })

  it('keeps tablet out of the embedded mobile breakpoint', () => {
    expect(EMBEDDED_MOBILE_BANNER_MEDIA).toBe('(max-width: 639px)')
    expect(marketplaceTabletBannerMedia(false)).toBe('(min-width: 640px) and (max-width: 1023px)')
  })
})
