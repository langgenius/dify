import type { ComponentProps } from 'react'
import type { InSiteMessageActionItem } from '../index'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { trackEvent } from '@/app/components/base/amplitude'
import InSiteMessage from '../index'

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

describe('InSiteMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (
    actions: InSiteMessageActionItem[],
    props?: Partial<ComponentProps<typeof InSiteMessage>>,
  ) => {
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
        { action: 'close', action_name: 'outline', text: 'Outline', type: 'outline' },
        {
          action: 'link',
          action_name: 'learn_more',
          text: 'Learn more',
          type: 'primary',
          data: 'https://example.com',
        },
      ]

      renderComponent(actions, { className: 'custom-message' })

      const closeButton = screen.getByRole('button', { name: 'Close' })
      const outlineButton = screen.getByRole('button', { name: 'Outline' })
      const learnMoreLink = screen.getByRole('link', { name: 'Learn more' })
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
      expect(outlineButton).toHaveClass('bg-components-button-secondary-bg')
      expect(learnMoreLink).toHaveAttribute('href', 'https://example.com')
    })

    it('should fallback to default header background when headerBgUrl is empty string', () => {
      const actions: InSiteMessageActionItem[] = [
        { action: 'close', action_name: 'dismiss', text: 'Close', type: 'default' },
      ]

      const { container } = renderComponent(actions, { headerBgUrl: '' })
      const header = container.querySelector('div[style]')
      expect(header).toHaveStyle({ backgroundImage: 'url(/in-site-message/header-bg.svg)' })
    })
  })

  // Validate action handling for close and link actions.
  describe('Actions', () => {
    it('should call onAction and hide component when close action is clicked', () => {
      const onAction = vi.fn()
      const closeAction: InSiteMessageActionItem = {
        action: 'close',
        action_name: 'dismiss',
        text: 'Close',
        type: 'default',
      }

      renderComponent([closeAction], { onAction })
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(onAction).toHaveBeenCalledWith(closeAction)
      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    })

    it('should render a new-tab link and report its activation', () => {
      const onAction = vi.fn()
      const linkAction: InSiteMessageActionItem = {
        action: 'link',
        action_name: 'confirm',
        text: 'Open link',
        type: 'primary',
        data: 'https://example.com',
      }

      renderComponent([linkAction], { onAction })
      const link = screen.getByRole('link', { name: 'Open link' })

      expect(link).toHaveAttribute('href', 'https://example.com')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      fireEvent.click(link)

      expect(onAction).toHaveBeenCalledWith(linkAction)
      expect(vi.mocked(trackEvent)).toHaveBeenCalledWith('in_site_message_action', {
        notification_id: 'test-notification-id',
        action: 'confirm',
      })
    })

    it('should render a same-tab link when target is _self', () => {
      const linkAction: InSiteMessageActionItem = {
        action: 'link',
        action_name: 'confirm',
        text: 'Open self',
        type: 'primary',
        data: { href: 'https://example.com/self', target: '_self' },
      }

      renderComponent([linkAction])
      const link = screen.getByRole('link', { name: 'Open self' })

      expect(link).toHaveAttribute('href', 'https://example.com/self')
      expect(link).toHaveAttribute('target', '_self')
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

      expect(screen.queryByRole('link', { name: 'Broken link' })).not.toBeInTheDocument()
    })
  })
})
