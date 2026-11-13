import type { CreatorProfileViewModel } from '../model'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import CreatorProfileView from '../view'

const brokenBackground = 'data:image/png;base64,broken'
const profile: CreatorProfileViewModel = {
  profile: {
    kind: 'individual',
    displayName: 'Creator',
    handle: 'creator',
    avatarUrl: '',
    backgroundUrl: brokenBackground,
    badges: [],
    socialLinks: [],
  },
  creations: [],
}

async function renderProfile() {
  return render(
    <NuqsTestingAdapter>
      <main>
        <CreatorProfileView
          profile={profile}
          homeHref="/marketplace"
          isMarketplacePlatform
          getCreationAction={() => ({ type: 'link', href: '/' })}
        />
      </main>
    </NuqsTestingAdapter>,
  )
}

it('keeps creator content and keyboard navigation inside the parent main landmark', async () => {
  const screen = await renderProfile()
  const main = screen.getByRole('main')
  await expect.element(main.getByRole('heading', { level: 1, name: 'Creator' })).toBeVisible()
  const home = main
    .getByRole('navigation', { name: 'plugin.marketplace.creatorProfile.breadcrumbLabel' })
    .getByRole('link', { name: 'plugin.marketplace.creatorProfile.home' })
  await userEvent.tab()
  await expect.element(home).toHaveFocus()
  await expect.element(home).toHaveAttribute('href', '/marketplace')
  await expect.element(screen.getByRole('complementary')).not.toBeInTheDocument()
})

it('removes a failed remote background from view after native image decoding fails', async () => {
  await renderProfile()
  // Decorative backgrounds have no accessible role; inspect the native image loading boundary.
  const image = document.querySelector<HTMLImageElement>(`img[src="${brokenBackground}"]`)!
  await expect.poll(() => image.complete).toBe(true)
  expect(image.naturalWidth).toBe(0)
  await expect.element(image).not.toBeVisible()
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
