import type { CreatorProfileViewModel } from '../model'
import { fireEvent, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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
  default: () => <section>Creator content</section>,
}))

const profile: CreatorProfileViewModel = {
  profile: {
    kind: 'individual',
    displayName: 'Creator',
    handle: 'creator',
    avatarUrl: '/creator-avatar.png',
    backgroundUrl: '/creator-background.png',
    badges: [],
    socialLinks: [],
  },
  creations: [],
}

describe('CreatorProfileView SSR background', () => {
  it('includes the default background in server markup before the remote background loads', () => {
    const markup = renderToStaticMarkup(
      <CreatorProfileView
        profile={profile}
        homeHref="/"
        isMarketplacePlatform={false}
        getCreationAction={() => ({ type: 'link', href: '/' })}
      />,
    )

    expect(markup).toContain('default-background.png')
    expect(markup).toContain('src="/creator-background.png"')
  })

  it('server-renders only the default background when the profile has no background', () => {
    const markup = renderToStaticMarkup(
      <CreatorProfileView
        profile={{
          ...profile,
          profile: { ...profile.profile, backgroundUrl: '' },
        }}
        homeHref="/"
        isMarketplacePlatform={false}
        getCreationAction={() => ({ type: 'link', href: '/' })}
      />,
    )

    expect(markup).toContain('default-background.png')
    expect(markup).not.toContain('<img')
    expect(markup).toContain('border-0')
  })

  it('hides a stale remote image after a loading failure', () => {
    const { container } = render(
      <CreatorProfileView
        profile={profile}
        homeHref="/"
        isMarketplacePlatform={false}
        getCreationAction={() => ({ type: 'link', href: '/' })}
      />,
    )
    const remoteBackground = container.querySelector<HTMLImageElement>(
      'img[src="/creator-background.png"]',
    )!

    fireEvent.error(remoteBackground)

    expect(remoteBackground).toHaveAttribute('hidden')
    expect(remoteBackground).toHaveClass('border-0')
  })
})
