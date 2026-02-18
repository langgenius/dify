import type { AppContextValue } from '@/context/app-context'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import EnvNav from './index'

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

describe('EnvNav', () => {
  const mockUseAppContext = vi.mocked(useAppContext)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render null when environment is PRODUCTION', () => {
    mockUseAppContext.mockReturnValue({
      langGeniusVersionInfo: {
        current_env: 'PRODUCTION',
      },
    } as unknown as AppContextValue)

    const { container } = render(<EnvNav />)
    expect(container.firstChild).toBeNull()
  })

  it('should render TESTING tag and icon when environment is TESTING', () => {
    mockUseAppContext.mockReturnValue({
      langGeniusVersionInfo: {
        current_env: 'TESTING',
      },
    } as unknown as AppContextValue)

    render(<EnvNav />)
    expect(screen.getByText('common.environment.testing')).toBeInTheDocument()
    // Verify wrapper class for TESTING
    const wrapper = screen.getByText(
      'common.environment.testing',
    ).parentElement
    expect(wrapper).toHaveClass('bg-[#A5F0FC]')
    expect(wrapper).toHaveClass('border-[#67E3F9]')
    expect(wrapper).toHaveClass('text-[#164C63]')
    // Beaker02 icon is rendered
    expect(document.querySelector('svg')).toHaveAttribute(
      'data-icon',
      'Beaker02',
    )
  })

  it('should render DEVELOPMENT tag and icon when environment is DEVELOPMENT', () => {
    mockUseAppContext.mockReturnValue({
      langGeniusVersionInfo: {
        current_env: 'DEVELOPMENT',
      },
    } as unknown as AppContextValue)

    render(<EnvNav />)
    expect(
      screen.getByText('common.environment.development'),
    ).toBeInTheDocument()
    // Verify wrapper class for DEVELOPMENT
    const wrapper = screen.getByText(
      'common.environment.development',
    ).parentElement
    expect(wrapper).toHaveClass('bg-[#FEC84B]')
    expect(wrapper).toHaveClass('border-[#FDB022]')
    expect(wrapper).toHaveClass('text-[#93370D]')
    // TerminalSquare icon is rendered
    expect(document.querySelector('svg')).toHaveAttribute(
      'data-icon',
      'TerminalSquare',
    )
  })
})
