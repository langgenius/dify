import type { SiteInfo } from '@/models/share'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InfoModal from './info-modal'

// Only mock react-i18next for translations
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => {
  cleanup()
})

describe('InfoModal', () => {
  const mockOnClose = vi.fn()

  const baseSiteInfo: SiteInfo = {
    title: 'Test App',
    icon: '🚀',
    icon_type: 'emoji',
    icon_background: '#ffffff',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should not render when isShow is false', () => {
      render(
        <InfoModal
          isShow={false}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      expect(screen.queryByText('Test App')).not.toBeInTheDocument()
    })

    it('should render when isShow is true', () => {
      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should render app title', () => {
      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should render copyright when provided', () => {
      const siteInfoWithCopyright: SiteInfo = {
        ...baseSiteInfo,
        copyright: 'Dify Inc.',
      }

      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithCopyright}
        />,
      )

      expect(screen.getByText(/Dify Inc./)).toBeInTheDocument()
    })

    it('should render current year in copyright', () => {
      const siteInfoWithCopyright: SiteInfo = {
        ...baseSiteInfo,
        copyright: 'Test Company',
      }

      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithCopyright}
        />,
      )

      const currentYear = new Date().getFullYear().toString()
      expect(screen.getByText(new RegExp(currentYear))).toBeInTheDocument()
    })

    it('should render custom disclaimer when provided', () => {
      const siteInfoWithDisclaimer: SiteInfo = {
        ...baseSiteInfo,
        custom_disclaimer: 'This is a custom disclaimer',
      }

      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithDisclaimer}
        />,
      )

      expect(screen.getByText('This is a custom disclaimer')).toBeInTheDocument()
    })

    it('should not render copyright section when not provided', () => {
      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      const year = new Date().getFullYear().toString()
      expect(screen.queryByText(new RegExp(`©.*${year}`))).not.toBeInTheDocument()
    })

    it('should render with undefined data', () => {
      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={undefined}
        />,
      )

      // Modal should still render but without content
      expect(screen.queryByText('Test App')).not.toBeInTheDocument()
    })

    it('should render with image icon type', () => {
      const siteInfoWithImage: SiteInfo = {
        ...baseSiteInfo,
        icon_type: 'image',
        icon_url: 'https://example.com/icon.png',
      }

      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithImage}
        />,
      )

      expect(screen.getByText(siteInfoWithImage.title!)).toBeInTheDocument()
    })
  })

  describe('close functionality', () => {
    it('should call onClose when close button is clicked', () => {
      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      // Find the close icon (RiCloseLine) which has text-text-tertiary class
      const closeIcon = document.querySelector('[class*="text-text-tertiary"]')
      expect(closeIcon).toBeInTheDocument()
      if (closeIcon) {
        fireEvent.click(closeIcon)
        expect(mockOnClose).toHaveBeenCalled()
      }
    })
  })

  describe('both copyright and disclaimer', () => {
    it('should render both when both are provided', () => {
      const siteInfoWithBoth: SiteInfo = {
        ...baseSiteInfo,
        copyright: 'My Company',
        custom_disclaimer: 'Disclaimer text here',
      }

      render(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithBoth}
        />,
      )

      expect(screen.getByText(/My Company/)).toBeInTheDocument()
      expect(screen.getByText('Disclaimer text here')).toBeInTheDocument()
    })
  })
})
