import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeprecationNotice from '../deprecation-notice'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode, href: string }) => (
    <a data-testid="link" href={href}>{children}</a>
  ),
}))

describe('DeprecationNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('returns null when status is not "deleted"', () => {
    const { container } = render(
      <DeprecationNotice
        status="active"
        deprecatedReason="business_adjustments"
        alternativePluginId="alt-plugin"
        alternativePluginURL="/plugins/alt-plugin"
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders deprecation notice when status is "deleted"', () => {
    render(
      <DeprecationNotice
        status="deleted"
        deprecatedReason=""
        alternativePluginId=""
        alternativePluginURL=""
      />,
    )
    expect(screen.getByText('plugin.detailPanel.deprecation.noReason')).toBeInTheDocument()
  })

  it('renders with valid reason and alternative plugin', () => {
    render(
      <DeprecationNotice
        status="deleted"
        deprecatedReason="business_adjustments"
        alternativePluginId="better-plugin"
        alternativePluginURL="/plugins/better-plugin"
      />,
    )
    expect(screen.getByText('detailPanel.deprecation.fullMessage')).toBeInTheDocument()
  })

  it('renders only reason without alternative plugin', () => {
    render(
      <DeprecationNotice
        status="deleted"
        deprecatedReason="no_maintainer"
        alternativePluginId=""
        alternativePluginURL=""
      />,
    )
    expect(screen.getByText(/plugin\.detailPanel\.deprecation\.onlyReason/)).toBeInTheDocument()
  })

  it('renders no-reason message for invalid reason', () => {
    render(
      <DeprecationNotice
        status="deleted"
        deprecatedReason="unknown_reason"
        alternativePluginId=""
        alternativePluginURL=""
      />,
    )
    expect(screen.getByText('plugin.detailPanel.deprecation.noReason')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <DeprecationNotice
        status="deleted"
        deprecatedReason=""
        alternativePluginId=""
        alternativePluginURL=""
        className="my-custom-class"
      />,
    )
    expect((container.firstChild as HTMLElement).className).toContain('my-custom-class')
  })
})
