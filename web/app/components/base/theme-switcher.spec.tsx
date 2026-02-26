import { fireEvent, render, screen } from '@testing-library/react'
import ThemeSwitcher from './theme-switcher'

let mockTheme = 'system'
const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}))

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'system'
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<ThemeSwitcher />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render three theme option buttons', () => {
      render(<ThemeSwitcher />)
      expect(screen.getByTestId('system-theme-container')).toBeInTheDocument()
      expect(screen.getByTestId('light-theme-container')).toBeInTheDocument()
      expect(screen.getByTestId('dark-theme-container')).toBeInTheDocument()
    })

    it('should render two dividers between options', () => {
      render(<ThemeSwitcher />)
      const dividers = screen.getAllByTestId('divider')
      expect(dividers).toHaveLength(2)
    })
  })

  describe('User Interactions', () => {
    it('should call setTheme with system when system option is clicked', () => {
      render(<ThemeSwitcher />)
      fireEvent.click(screen.getByTestId('system-theme-container')) // system is first
      expect(mockSetTheme).toHaveBeenCalledWith('system')
    })

    it('should call setTheme with light when light option is clicked', () => {
      render(<ThemeSwitcher />)
      fireEvent.click(screen.getByTestId('light-theme-container')) // light is second
      expect(mockSetTheme).toHaveBeenCalledWith('light')
    })

    it('should call setTheme with dark when dark option is clicked', () => {
      render(<ThemeSwitcher />)
      fireEvent.click(screen.getByTestId('dark-theme-container')) // dark is third
      expect(mockSetTheme).toHaveBeenCalledWith('dark')
    })
  })

  describe('Theme-specific rendering', () => {
    it('should highlight system option when theme is system', () => {
      mockTheme = 'system'
      render(<ThemeSwitcher />)
      expect(screen.getByTestId('system-theme-container')).toHaveClass('bg-components-segmented-control-item-active-bg')
      expect(screen.getByTestId('light-theme-container')).not.toHaveClass('bg-components-segmented-control-item-active-bg')
      expect(screen.getByTestId('dark-theme-container')).not.toHaveClass('bg-components-segmented-control-item-active-bg')
    })

    it('should highlight light option when theme is light', () => {
      mockTheme = 'light'
      render(<ThemeSwitcher />)
      expect(screen.getByTestId('light-theme-container')).toHaveClass('bg-components-segmented-control-item-active-bg')
      expect(screen.getByTestId('system-theme-container')).not.toHaveClass('bg-components-segmented-control-item-active-bg')
      expect(screen.getByTestId('dark-theme-container')).not.toHaveClass('bg-components-segmented-control-item-active-bg')
    })

    it('should highlight dark option when theme is dark', () => {
      mockTheme = 'dark'
      render(<ThemeSwitcher />)
      expect(screen.getByTestId('dark-theme-container')).toHaveClass('bg-components-segmented-control-item-active-bg')
      expect(screen.getByTestId('system-theme-container')).not.toHaveClass('bg-components-segmented-control-item-active-bg')
      expect(screen.getByTestId('light-theme-container')).not.toHaveClass('bg-components-segmented-control-item-active-bg')
    })

    it('should show divider between system and light when dark is active', () => {
      mockTheme = 'dark'
      render(<ThemeSwitcher />)
      const dividers = screen.getAllByTestId('divider')
      expect(dividers[0]).toHaveClass('bg-divider-regular')
    })

    it('should show divider between light and dark when system is active', () => {
      mockTheme = 'system'
      render(<ThemeSwitcher />)
      const dividers = screen.getAllByTestId('divider')
      expect(dividers[1]).toHaveClass('bg-divider-regular')
    })

    it('should have transparent dividers when neither adjacent theme is active', () => {
      mockTheme = 'light'
      render(<ThemeSwitcher />)
      const dividers = screen.getAllByTestId('divider')
      expect(dividers[0]).not.toHaveClass('bg-divider-regular')
      expect(dividers[1]).not.toHaveClass('bg-divider-regular')
    })
  })
})
