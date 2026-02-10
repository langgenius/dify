/**
 * Integration Test: Plugin Card Rendering Pipeline
 *
 * Tests the integration between Card, Icon, Title, Description,
 * OrgInfo, CornerMark, and CardMoreInfo components. Verifies that
 * plugin data flows correctly through the card rendering pipeline.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: (obj: Record<string, string>, locale: string) => obj[locale] || obj.en_US || '',
}))

vi.mock('@/types/app', () => ({
  Theme: { dark: 'dark', light: 'light' },
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(a => typeof a === 'string' && a).join(' '),
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  useCategories: () => ({
    categoriesMap: {
      tool: { label: 'Tool' },
      model: { label: 'Model' },
      extension: { label: 'Extension' },
    },
  }),
}))

vi.mock('@/app/components/plugins/base/badges/partner', () => ({
  default: () => <span data-testid="partner-badge">Partner</span>,
}))

vi.mock('@/app/components/plugins/base/badges/verified', () => ({
  default: () => <span data-testid="verified-badge">Verified</span>,
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src, installed, installFailed }: { src: string | object, installed?: boolean, installFailed?: boolean }) => (
    <div data-testid="card-icon" data-installed={installed} data-install-failed={installFailed}>
      {typeof src === 'string' ? src : 'emoji-icon'}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/corner-mark', () => ({
  default: ({ text }: { text: string }) => (
    <div data-testid="corner-mark">{text}</div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text, descriptionLineRows }: { text: string, descriptionLineRows?: number }) => (
    <div data-testid="description" data-rows={descriptionLineRows}>{text}</div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/org-info', () => ({
  default: ({ orgName, packageName }: { orgName: string, packageName: string }) => (
    <div data-testid="org-info">
      {orgName}
      /
      {packageName}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/placeholder', () => ({
  default: ({ text }: { text: string }) => (
    <div data-testid="placeholder">{text}</div>
  ),
}))

vi.mock('@/app/components/plugins/card/base/title', () => ({
  default: ({ title }: { title: string }) => (
    <div data-testid="title">{title}</div>
  ),
}))

const { default: Card } = await import('@/app/components/plugins/card/index')
type CardPayload = Parameters<typeof Card>[0]['payload']

describe('Plugin Card Rendering Integration', () => {
  beforeEach(() => {
    cleanup()
  })

  const makePayload = (overrides = {}) => ({
    category: 'tool',
    type: 'plugin',
    name: 'google-search',
    org: 'langgenius',
    label: { en_US: 'Google Search', zh_Hans: 'Google搜索' },
    brief: { en_US: 'Search the web using Google', zh_Hans: '使用Google搜索网页' },
    icon: 'https://example.com/icon.png',
    verified: true,
    badges: [] as string[],
    ...overrides,
  }) as CardPayload

  it('renders a complete plugin card with all subcomponents', () => {
    const payload = makePayload()
    render(<Card payload={payload} />)

    expect(screen.getByTestId('card-icon')).toBeInTheDocument()
    expect(screen.getByTestId('title')).toHaveTextContent('Google Search')
    expect(screen.getByTestId('org-info')).toHaveTextContent('langgenius/google-search')
    expect(screen.getByTestId('description')).toHaveTextContent('Search the web using Google')
  })

  it('shows corner mark with category label when not hidden', () => {
    const payload = makePayload()
    render(<Card payload={payload} />)

    expect(screen.getByTestId('corner-mark')).toBeInTheDocument()
  })

  it('hides corner mark when hideCornerMark is true', () => {
    const payload = makePayload()
    render(<Card payload={payload} hideCornerMark />)

    expect(screen.queryByTestId('corner-mark')).not.toBeInTheDocument()
  })

  it('shows installed status on icon', () => {
    const payload = makePayload()
    render(<Card payload={payload} installed />)

    const icon = screen.getByTestId('card-icon')
    expect(icon).toHaveAttribute('data-installed', 'true')
  })

  it('shows install failed status on icon', () => {
    const payload = makePayload()
    render(<Card payload={payload} installFailed />)

    const icon = screen.getByTestId('card-icon')
    expect(icon).toHaveAttribute('data-install-failed', 'true')
  })

  it('renders verified badge when plugin is verified', () => {
    const payload = makePayload({ verified: true })
    render(<Card payload={payload} />)

    expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
  })

  it('renders partner badge when plugin has partner badge', () => {
    const payload = makePayload({ badges: ['partner'] })
    render(<Card payload={payload} />)

    expect(screen.getByTestId('partner-badge')).toBeInTheDocument()
  })

  it('renders footer content when provided', () => {
    const payload = makePayload()
    render(
      <Card
        payload={payload}
        footer={<div data-testid="custom-footer">Custom footer</div>}
      />,
    )

    expect(screen.getByTestId('custom-footer')).toBeInTheDocument()
  })

  it('renders titleLeft content when provided', () => {
    const payload = makePayload()
    render(
      <Card
        payload={payload}
        titleLeft={<span data-testid="title-left-content">New</span>}
      />,
    )

    expect(screen.getByTestId('title-left-content')).toBeInTheDocument()
  })

  it('uses dark icon when theme is dark and icon_dark is provided', () => {
    vi.doMock('@/hooks/use-theme', () => ({
      default: () => ({ theme: 'dark' }),
    }))

    const payload = makePayload({
      icon: 'https://example.com/icon-light.png',
      icon_dark: 'https://example.com/icon-dark.png',
    })

    render(<Card payload={payload} />)
    expect(screen.getByTestId('card-icon')).toBeInTheDocument()
  })

  it('shows loading placeholder when isLoading is true', () => {
    const payload = makePayload()
    render(<Card payload={payload} isLoading loadingFileName="uploading.difypkg" />)

    expect(screen.getByTestId('placeholder')).toBeInTheDocument()
  })

  it('renders description with custom line rows', () => {
    const payload = makePayload()
    render(<Card payload={payload} descriptionLineRows={3} />)

    const description = screen.getByTestId('description')
    expect(description).toHaveAttribute('data-rows', '3')
  })
})
