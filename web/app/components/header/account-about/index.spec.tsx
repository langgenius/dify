import type { LangGeniusVersionResponse } from '@/models/common'
import type { SystemFeatures } from '@/types/feature'
import { fireEvent, render, screen } from '@testing-library/react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import AccountAbout from './index'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

let mockIsCEEdition = false
vi.mock('@/config', () => ({
  get IS_CE_EDITION() { return mockIsCEEdition },
}))

type GlobalPublicStore = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (systemFeatures: SystemFeatures) => void
}

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
    vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
      systemFeatures: { branding: { enabled: false } },
    } as unknown as GlobalPublicStore))
  })

  describe('Rendering', () => {
    it('should render correctly with version information', () => {
      // Act
      render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)

      // Assert
      expect(screen.getByText(/^Version/)).toBeInTheDocument()
      expect(screen.getAllByText(/0.6.0/).length).toBeGreaterThan(0)
    })

    it('should render branding logo if enabled', () => {
      // Arrange
      vi.mocked(useGlobalPublicStore).mockImplementation(selector => selector({
        systemFeatures: { branding: { enabled: true, workspace_logo: 'custom-logo.png' } },
      } as unknown as GlobalPublicStore))

      // Act
      render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)

      // Assert
      const img = screen.getByAltText('logo')
      expect(img).toBeInTheDocument()
      expect(img).toHaveAttribute('src', 'custom-logo.png')
    })
  })

  describe('Version Logic', () => {
    it('should show "Latest Available" when current version equals latest', () => {
      // Act
      render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)

      // Assert
      expect(screen.getByText(/about.latestAvailable/)).toBeInTheDocument()
    })

    it('should show "Now Available" when current version is behind', () => {
      // Arrange
      const behindVersionInfo = { ...mockVersionInfo, latest_version: '0.7.0' }

      // Act
      render(<AccountAbout langGeniusVersionInfo={behindVersionInfo} onCancel={mockOnCancel} />)

      // Assert
      expect(screen.getByText(/about.nowAvailable/)).toBeInTheDocument()
      expect(screen.getByText(/about.updateNow/)).toBeInTheDocument()
    })
  })

  describe('Community Edition', () => {
    it('should render correctly in Community Edition', () => {
      // Arrange
      mockIsCEEdition = true

      // Act
      render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)

      // Assert
      expect(screen.getByText(/Open Source License/)).toBeInTheDocument()
    })

    it('should hide update button in Community Edition when behind version', () => {
      // Arrange
      mockIsCEEdition = true
      const behindVersionInfo = { ...mockVersionInfo, latest_version: '0.7.0' }

      // Act
      render(<AccountAbout langGeniusVersionInfo={behindVersionInfo} onCancel={mockOnCancel} />)

      // Assert
      expect(screen.queryByText(/about.updateNow/)).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when close button is clicked', () => {
      // Act
      render(<AccountAbout langGeniusVersionInfo={mockVersionInfo} onCancel={mockOnCancel} />)
      // Modal uses Headless UI Dialog which renders into a portal, so we need to use document
      const closeButton = document.querySelector('div.absolute.cursor-pointer')

      if (!closeButton)
        throw new Error('Close button not found')

      fireEvent.click(closeButton)

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })
})
