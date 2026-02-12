import type { SiteInfo } from '@/models/share'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InfoModal from '../info-modal'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
})

async function renderModal(ui: React.ReactElement) {
  const result = render(ui)
  await act(async () => {
    vi.runAllTimers()
  })
  return result
}

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
    it('should not render when isShow is false', async () => {
      await renderModal(
        <InfoModal
          isShow={false}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      expect(screen.queryByText('Test App')).not.toBeInTheDocument()
    })

    it('should render when isShow is true', async () => {
      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should render app title', async () => {
      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should render copyright when provided', async () => {
      const siteInfoWithCopyright: SiteInfo = {
        ...baseSiteInfo,
        copyright: 'Dify Inc.',
      }

      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithCopyright}
        />,
      )

      expect(screen.getByText(/Dify Inc./)).toBeInTheDocument()
    })

    it('should render current year in copyright', async () => {
      const siteInfoWithCopyright: SiteInfo = {
        ...baseSiteInfo,
        copyright: 'Test Company',
      }

      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithCopyright}
        />,
      )

      const currentYear = new Date().getFullYear().toString()
      expect(screen.getByText(new RegExp(currentYear))).toBeInTheDocument()
    })

    it('should render custom disclaimer when provided', async () => {
      const siteInfoWithDisclaimer: SiteInfo = {
        ...baseSiteInfo,
        custom_disclaimer: 'This is a custom disclaimer',
      }

      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={siteInfoWithDisclaimer}
        />,
      )

      expect(screen.getByText('This is a custom disclaimer')).toBeInTheDocument()
    })

    it('should not render copyright section when not provided', async () => {
      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      const year = new Date().getFullYear().toString()
      expect(screen.queryByText(new RegExp(`©.*${year}`))).not.toBeInTheDocument()
    })

    it('should render with undefined data', async () => {
      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={undefined}
        />,
      )

      expect(screen.queryByText('Test App')).not.toBeInTheDocument()
    })

    it('should render with image icon type', async () => {
      const siteInfoWithImage: SiteInfo = {
        ...baseSiteInfo,
        icon_type: 'image',
        icon_url: 'https://example.com/icon.png',
      }

      await renderModal(
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
    it('should call onClose when close button is clicked', async () => {
      await renderModal(
        <InfoModal
          isShow={true}
          onClose={mockOnClose}
          data={baseSiteInfo}
        />,
      )

      const closeIcon = document.querySelector('[class*="text-text-tertiary"]')
      expect(closeIcon).toBeInTheDocument()
      if (closeIcon) {
        fireEvent.click(closeIcon)
        expect(mockOnClose).toHaveBeenCalled()
      }
    })
  })

  describe('both copyright and disclaimer', () => {
    it('should render both when both are provided', async () => {
      const siteInfoWithBoth: SiteInfo = {
        ...baseSiteInfo,
        copyright: 'My Company',
        custom_disclaimer: 'Disclaimer text here',
      }

      await renderModal(
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
