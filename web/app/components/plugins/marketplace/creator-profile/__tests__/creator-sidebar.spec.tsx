import type { CreatorProfileViewModel } from '../model'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CreatorSidebar from '../creator-sidebar'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

vi.mock('../publisher-avatar', () => ({
  default: ({ className, size }: { className?: string; size?: number }) => (
    <div data-testid="publisher-avatar" data-size={size} className={className} />
  ),
}))

const profile: CreatorProfileViewModel['profile'] = {
  kind: 'individual',
  displayName: 'Creator',
  handle: 'creator',
  avatarUrl: '',
  backgroundUrl: '',
  badges: [],
  socialLinks: [
    { platform: 'website', href: 'https://example.com/', label: 'example.com' },
    { platform: 'x', href: 'https://x.com/creator', label: 'x.com/creator' },
    {
      platform: 'instagram',
      href: 'https://instagram.com/creator',
      label: 'instagram.com/creator',
    },
    {
      platform: 'youtube',
      href: 'https://youtube.com/creator',
      label: 'youtube.com/creator',
    },
    { platform: 'figma', href: 'https://figma.com/@creator', label: 'figma.com/@creator' },
    { platform: 'github', href: 'https://github.com/creator', label: 'github.com/creator' },
  ],
}

describe('CreatorSidebar social links', () => {
  it('adds a light shadow without changing the avatar geometry', () => {
    render(<CreatorSidebar profile={profile} />)

    const avatar = screen.getByTestId('publisher-avatar')

    expect(avatar).toHaveClass('shadow-xs')
    expect(avatar).toHaveClass(
      'absolute',
      '-top-12',
      '-left-2',
      '!size-20',
      'border-[1.5px]',
      'md:-top-[68px]',
      'md:!size-[100px]',
    )
    expect(avatar).toHaveAttribute('data-size', '100')
  })

  it('renders a static platform icon at the start of every social row', () => {
    render(<CreatorSidebar profile={profile} />)

    const expectedClasses = [
      ['example.com', 'i-ri-global-line'],
      ['x.com/creator', 'i-ri-twitter-x-fill'],
      ['instagram.com/creator', 'i-ri-instagram-line'],
      ['youtube.com/creator', 'i-ri-youtube-fill'],
      ['figma.com/@creator', 'i-ri-figma-line'],
      ['github.com/creator', 'i-ri-github-fill'],
    ]

    for (const [name, iconClass] of expectedClasses) {
      const link = screen.getByRole('link', { name })
      expect(link.firstElementChild).toHaveClass(iconClass!)
      expect(link.firstElementChild).toHaveClass('size-4')
    }
  })
})
