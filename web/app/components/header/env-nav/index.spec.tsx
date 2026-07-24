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
  })
})
