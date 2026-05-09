import type { LangGeniusVersionResponse } from '@/models/common'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import AccountAbout from '../index'

let mockIsCEEdition = false
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get IS_CE_EDITION() { return mockIsCEEdition },
  }
})

describe('AccountAbout', () => {
  const mockVersionInfo: LangGeniusVersionResponse = {
    current_version: '0.6.0',
    latest_version: '0.6.0',
    release_notes: 'https://github.com/langgenius/dify/releases/tag/0.6.0',
    version: '0.6.0',
    release_date: '2024-01-01',
    can_auto_update: false,
    current_env: 'production',
  }

  const mockOnCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCEEdition = false
  })

  describe('Rendering', () => {
    it('should render correctly with version information', () => {
      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />, {
        systemFeatures: { branding: { enabled: false } },
      })

      expect(screen.getByText(/^Version/)).toBeInTheDocument()
      expect(screen.getAllByText(/0.6.0/).length).toBeGreaterThan(0)
    })

    it('should render branding logo if enabled', () => {
      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />, {
        systemFeatures: { branding: { enabled: true, workspace_logo: 'custom-logo.png' } },
      })

      const img = screen.getByAltText('logo')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'custom-logo.png')
    })
  })

  describe('Version Logic', () => {
    it('should show "Latest Available" when current version equals latest', () => {
      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)

      expect(screen.getByText(/about.latestAvailable/)).toBeInTheDocument()
    })

    it('should show "Now Available" when current version is behind', () => {
      const behindVersionInfo = { ...mockVersionInfo, latest_version: '0.7.0' }

      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={behindVersionInfo} onCancel={mockOnCancel} />)

      expect(screen.getByText(/about.nowAvailable/)).toBeInTheDocument()
      expect(screen.getByText(/about.updateNow/)).toBeInTheDocument()
    })
  })

  describe('Community Edition', () => {
    it('should render correctly in Community Edition', () => {
      mockIsCEEdition = true

      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)

      expect(screen.getByText(/Open Source License/)).toBeInTheDocument()
    })

    it('should hide update button in Community Edition when behind version', () => {
      mockIsCEEdition = true
      const behindVersionInfo = { ...mockVersionInfo, latest_version: '0.7.0' }

      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={behindVersionInfo} onCancel={mockOnCancel} />)

      expect(screen.queryByText(/about.updateNow/)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      renderWithSystemFeatures(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)
      // Modal content renders into a portal, so we need to use document.
      const closeButton = document.querySelector('div.absolute.cursor-pointer')

      if (!closeButton)
        throw new Error('Close button not found')

      fireEvent.click(closeButton)

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})
