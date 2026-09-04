import type { CreatorProfileViewModel } from '../model'
import { render } from 'vitest-browser-react'
import CreatorProfileView from '../view'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')

  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('../creator-sidebar', () => ({
  default: () => <aside>Creator sidebar</aside>,
}))

vi.mock('../creator-content', () => ({
  default: () => (
    <section data-testid="creator-creations" style={{ height: 640, flexShrink: 0 }}>
      Creator content
    </section>
  ),
}))

const profile: CreatorProfileViewModel = {
  profile: {
    kind: 'individual',
    displayName: 'Creator',
    handle: 'creator',
    avatarUrl: '',
    backgroundUrl: '',
    badges: [],
    socialLinks: [],
  },
  creations: [],
}

describe('CreatorProfileView layout', () => {
  it('keeps the profile background behind content taller than its scrollport', async () => {
    const screen = await render(
      <div
        data-testid="creator-scrollport"
        style={{ display: 'flex', height: 320, flexDirection: 'column', overflowY: 'auto' }}
      >
        <CreatorProfileView
          profile={profile}
          homeHref="/"
          isMarketplacePlatform={false}
          getCreationAction={() => ({ type: 'link', href: '/' })}
        />
      </div>,
    )

    const scrollport = screen.getByTestId('creator-scrollport').element()
    const profileRoot = scrollport.firstElementChild as HTMLElement
    const creations = screen.getByTestId('creator-creations').element()

    expect(profileRoot.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(
      creations.getBoundingClientRect().bottom,
    )
  })
})
