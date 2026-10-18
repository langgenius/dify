import { describe, expect, it } from 'vite-plus/test'
import { resolveEventAdBannerImageSrcs } from '../event-ad-banner-image'

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
