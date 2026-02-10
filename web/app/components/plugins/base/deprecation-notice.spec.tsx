import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeprecationNotice from './deprecation-notice'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detailPanel.deprecation.noReason': 'This plugin has been deprecated.',
        'detailPanel.deprecation.reason.businessAdjustments': 'business adjustments',
        'detailPanel.deprecation.reason.ownershipTransferred': 'ownership transferred',
        'detailPanel.deprecation.reason.noMaintainer': 'no maintainer',
      }
      if (key === 'detailPanel.deprecation.onlyReason')
        return `Deprecated due to ${opts?.deprecatedReason}`
      return map[key] || key
    },
  }),
}))

vi.mock('react-i18next', () => ({
  Trans: ({ values }: { values: Record<string, string> }) => (
    <span data-testid="trans">{`Deprecated: ${values?.deprecatedReason} → ${values?.alternativePluginId}`}</span>
  ),
}))

vi.mock('@remixicon/react', () => ({
  RiAlertFill: () => <span data-testid="alert-icon" />,
}))

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
    expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
    expect(screen.getByText('This plugin has been deprecated.')).toBeInTheDocument()
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
    expect(screen.getByTestId('trans')).toBeInTheDocument()
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
    expect(screen.getByText('Deprecated due to no maintainer')).toBeInTheDocument()
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
    expect(screen.getByText('This plugin has been deprecated.')).toBeInTheDocument()
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
