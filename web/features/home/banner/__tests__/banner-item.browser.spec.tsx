import type { BannerResponse } from '@dify/contracts/api/console/explore/types.gen'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { BannerItem } from '../banner-item'

const banner: BannerResponse = {
  id: 'banner',
  status: 'enabled',
  link: 'https://example.com/learn',
  created_at: '2024-01-01T00:00:00Z',
  sort: 1,
  content: {
    category: 'Featured',
    title: 'Learn Dify',
    description: 'Learn to build a workflow',
    'img-src': 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  },
}

it('exposes the named external destination across the visible banner content', async () => {
  onTestFinished(guardUnexpectedFetch())
  const screen = await render(
    <BannerItem banner={banner} sort={1} language="en-US" titleId="banner-title" />,
  )
  const link = screen.getByRole('link', { name: 'Learn Dify' })
  await expect.element(link).toBeVisible()
  expect(link.element().getAttribute('href')).toBe('https://example.com/learn')
  expect(link.element().getAttribute('target')).toBe('_blank')
  await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
  const text = screen.getByText('Learn to build a workflow')
  await expect.element(text).toBeVisible()
  const bounds = text.element().getBoundingClientRect()
  expect(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)).toBe(
    link.element(),
  )
  // Destination navigation is outside this component test; the real activation still reaches its owner.
  link.element().addEventListener('click', (event) => event.preventDefault(), { once: true })
  await link.click()
})

it('leaves destination-less content readable as an article', async () => {
  const screen = await render(
    <BannerItem
      banner={{ ...banner, link: '' }}
      sort={1}
      language="en-US"
      titleId="banner-title"
    />,
  )
  await expect.element(screen.getByRole('article')).toMatchTextContent('Learn Dify')
  await expect.element(screen.getByRole('link')).not.toBeInTheDocument()
})
