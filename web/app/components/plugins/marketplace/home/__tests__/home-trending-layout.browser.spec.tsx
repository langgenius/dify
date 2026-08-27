import type { PluginBanner } from '@dify/contracts/marketplace'
import { render } from 'vitest-browser-react'
import { HomeBannerSlide } from '../home-trending-slides'

const blogBanner: PluginBanner = {
  id: 'blog',
  style_type: 'blog',
  title: 'Dify Updates',
  sort: 0,
  language: 'en',
  content: {
    blog_title: 'Dify v1.9 new launch',
    subtitle: 'New Agent node support',
    description: 'Build agent workflows with the new Agent node.',
    link: 'https://dify.ai/blog',
    link_target_type: 'blog',
  },
}

describe('Marketplace home trending layout', () => {
  it('keeps the blog artwork left corners rounded when its image is cropped', async () => {
    const screen = await render(
      <div className="w-[600px]">
        <HomeBannerSlide banner={blogBanner} isMarketplacePlatform page="plugins" />
      </div>,
    )

    const artwork = screen.getByRole('link').element().querySelector('img')

    expect(artwork).not.toBeNull()
    expect(getComputedStyle(artwork!).borderTopLeftRadius).toBe('16px')
    expect(getComputedStyle(artwork!).borderBottomLeftRadius).toBe('16px')
  })
})
