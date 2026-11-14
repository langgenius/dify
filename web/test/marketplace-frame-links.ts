import type * as Links from '@/features/marketplace/links'

/** Local iframe documents preserve route parameters without contacting Marketplace. */
export function localMarketplaceFrameLinks(actual: typeof Links): typeof Links {
  const toBlank = (url: string) =>
    `about:blank${new URL(url, 'https://marketplace.example.test').search}`
  return {
    ...actual,
    marketplaceLinks: {
      ...actual.marketplaceLinks,
      plugin: (...args: Parameters<typeof actual.marketplaceLinks.plugin>) =>
        toBlank(actual.marketplaceLinks.plugin(...args)),
      template: (...args: Parameters<typeof actual.marketplaceLinks.template>) =>
        toBlank(actual.marketplaceLinks.template(...args)),
    },
  }
}
