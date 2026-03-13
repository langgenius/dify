import type { ComponentProps } from 'react'
import type { InSiteMessageActionItem } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InSiteMessage from './index'

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

describe('InSiteMessage', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('open', vi.fn())
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    })
    vi.unstubAllGlobals()
  })

  const renderComponent = (actions: InSiteMessageActionItem[], props?: Partial<ComponentProps<typeof InSiteMessage>>) => {
    return render(
      <InSiteMessage
        notificationId="test-notification-id"
        title="Title\\nLine"
        subtitle="Subtitle\\nLine"
        main="Main content"
        actions={actions}
        {...props}
      />,
    )
  }

  // Validate baseline rendering and content normalization.
  describe('Rendering', () => {
    it('should render title, subtitle, markdown content, and action buttons', () => {
      const actions: InSiteMessageActionItem[] = [
        { action: 'close', action_name: 'dismiss', text: 'Close', type: 'default' },
        { action: 'link', action_name: 'learn_more', text: 'Learn more', type: 'primary', data: 'https://example.com' },
      ]

      renderComponent(actions, { className: 'custom-message' })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      const learnMoreButton = screen.getByRole('button', { name: 'Learn more' })
      const panel = closeButton.closest('div.fixed')
      const titleElement = panel?.querySelector('.title-3xl-bold')
      const subtitleElement = panel?.querySelector('.body-md-regular')
      expect(panel).toHaveClass('custom-message')
      expect(titleElement).toHaveTextContent(/Title.*Line/s)
      expect(subtitleElement).toHaveTextContent(/Subtitle.*Line/s)
      expect(titleElement?.textContent).not.toContain('\\n')
      expect(subtitleElement?.textContent).not.toContain('\\n')
      expect(screen.getByText('Main content')).toBeInTheDocument()
      expect(closeButton).toBeInTheDocument()
      expect(learnMoreButton).toBeInTheDocument()
    })

    it('should fallback to default header background when headerBgUrl is empty string', () => {
      const actions: InSiteMessageActionItem[] = [{ action: 'close', action_name: 'dismiss', text: 'Close', type: 'default' }]

      const { container } = renderComponent(actions, { headerBgUrl: '' })
      const header = container.querySelector('div[style]')
      expect(header).toHaveStyle({ backgroundImage: 'url(/in-site-message/header-bg.svg)' })
    })
  })

  // Validate action handling for close and link actions.
  describe('Actions', () => {
    it('should call onAction and hide component when close action is clicked', () => {
      const onAction = vi.fn()
      const closeAction: InSiteMessageActionItem = { action: 'close', action_name: 'dismiss', text: 'Close', type: 'default' }

      renderComponent([closeAction], { onAction })
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(onAction).toHaveBeenCalledWith(closeAction)
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should open a new tab when link action data is a string', () => {
      const linkAction: InSiteMessageActionItem = {
        action: 'link',
        action_name: 'confirm',
        text: 'Open link',
        type: 'primary',
        data: 'https://example.com',
      }

      renderComponent([linkAction])
      fireEvent.click(screen.getByRole('button', { name: 'Open link' }))

      expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    })

    it('should navigate with location.assign when link action target is _self', () => {
      const assignSpy = vi.fn()
      Object.defineProperty(window, 'location', {
        value: {
          ...originalLocation,
          assign: assignSpy,
        },
        configurable: true,
      })

      const linkAction: InSiteMessageActionItem = {
        action: 'link',
        action_name: 'confirm',
        text: 'Open self',
        type: 'primary',
        data: { href: 'https://example.com/self', target: '_self' },
      }

      renderComponent([linkAction])
      fireEvent.click(screen.getByRole('button', { name: 'Open self' }))

      expect(assignSpy).toHaveBeenCalledWith('https://example.com/self')
      expect(window.open).not.toHaveBeenCalled()
    })

    it('should not trigger navigation when link data is invalid', () => {
      const linkAction: InSiteMessageActionItem = {
        action: 'link',
        action_name: 'confirm',
        text: 'Broken link',
        type: 'primary',
        data: { rel: 'noopener' },
      }

      renderComponent([linkAction])
      fireEvent.click(screen.getByRole('button', { name: 'Broken link' }))

      expect(window.open).not.toHaveBeenCalled()
    })
  })
})
