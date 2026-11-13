import type { CreatorProfileViewModel } from '../model'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import CreatorProfileView from '../view'

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
      <NuqsTestingAdapter>
        <CreatorProfileView
          profile={profile}
          homeHref="/"
          isMarketplacePlatform={false}
          getCreationAction={() => ({ type: 'link', href: '/' })}
        />
      </NuqsTestingAdapter>,
    )

    expect(markup).toContain('default-background.png')
    expect(markup).toContain('src="/creator-background.png"')
  })

  it('server-renders only the default background when the profile has no background', () => {
    const markup = renderToStaticMarkup(
      <NuqsTestingAdapter>
        <CreatorProfileView
          profile={{
            ...profile,
            profile: { ...profile.profile, backgroundUrl: '' },
          }}
          homeHref="/"
          isMarketplacePlatform={false}
          getCreationAction={() => ({ type: 'link', href: '/' })}
        />
      </NuqsTestingAdapter>,
    )

    expect(markup).toContain('default-background.png')
    expect(markup).not.toContain('src="/creator-background.png"')
  })
})
