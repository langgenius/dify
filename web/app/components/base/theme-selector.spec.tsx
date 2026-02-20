import { fireEvent, render, screen } from '@testing-library/react'
import ThemeSelector from './theme-selector'

// Mock next-themes with controllable state
let mockTheme = 'system'
const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}))

describe('ThemeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'system'
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ThemeSelector />)
      expect(container).toBeInTheDocument()
    })

    it('should render the trigger button', () => {
      render(<ThemeSelector />)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should not show dropdown content when closed', () => {
      render(<ThemeSelector />)
      expect(screen.queryByText(/common\.theme\.light/i)).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should show all theme options when dropdown is opened', () => {
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByText(/light/i)).toBeInTheDocument()
      expect(screen.getByText(/dark/i)).toBeInTheDocument()
      expect(screen.getByText(/auto/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call setTheme with light when light option is clicked', () => {
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      const lightButton = screen.getByText(/light/i).closest('button')!
      fireEvent.click(lightButton)
      expect(mockSetTheme).toHaveBeenCalledWith('light')
    })

    it('should call setTheme with dark when dark option is clicked', () => {
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      const darkButton = screen.getByText(/dark/i).closest('button')!
      fireEvent.click(darkButton)
      expect(mockSetTheme).toHaveBeenCalledWith('dark')
    })

    it('should call setTheme with system when system option is clicked', () => {
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      const systemButton = screen.getByText(/auto/i).closest('button')!
      fireEvent.click(systemButton)
      expect(mockSetTheme).toHaveBeenCalledWith('system')
    })
  })

  describe('Theme-specific rendering', () => {
    it('should show checkmark for the currently active light theme', () => {
      mockTheme = 'light'
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('light-icon')).toBeInTheDocument()
    })

    it('should show checkmark for the currently active dark theme', () => {
      mockTheme = 'dark'
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('dark-icon')).toBeInTheDocument()
    })

    it('should show checkmark for the currently active system theme', () => {
      mockTheme = 'system'
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('system-icon')).toBeInTheDocument()
    })

    it('should not show checkmark on non-active themes', () => {
      mockTheme = 'light'
      render(<ThemeSelector />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.queryByTestId('dark-icon')).not.toBeInTheDocument()
      expect(screen.queryByTestId('system-icon')).not.toBeInTheDocument()
    })
  })
})
