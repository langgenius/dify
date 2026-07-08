import type { AppContextValue } from '@/context/app-context'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import EnvNav from '../index'

const mockAppContextState = vi.hoisted(() => ({
  current: {} as Partial<AppContextValue>,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

describe('EnvNav', () => {
  const mockUseAppContext = vi.mocked(useAppContext)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render null when environment is PRODUCTION', () => {
    const appContextValue = {
      langGeniusVersionInfo: {
        current_env: 'PRODUCTION',
      },
    } as unknown as AppContextValue
    mockAppContextState.current = appContextValue
    mockUseAppContext.mockReturnValue(appContextValue)

    const { container } = render(<EnvNav />)
    expect(container.firstChild).toBeNull()
  })

  it('should render TESTING tag and icon when environment is TESTING', () => {
    const appContextValue = {
      langGeniusVersionInfo: {
        current_env: 'TESTING',
      },
    } as unknown as AppContextValue
    mockAppContextState.current = appContextValue
    mockUseAppContext.mockReturnValue(appContextValue)

    render(<EnvNav />)
    expect(screen.getByText('common.environment.testing')).toBeInTheDocument()
  })

  it('should render DEVELOPMENT tag and icon when environment is DEVELOPMENT', () => {
    const appContextValue = {
      langGeniusVersionInfo: {
        current_env: 'DEVELOPMENT',
      },
    } as unknown as AppContextValue
    mockAppContextState.current = appContextValue
    mockUseAppContext.mockReturnValue(appContextValue)

    render(<EnvNav />)
    expect(
      screen.getByText('common.environment.development'),
    ).toBeInTheDocument()
  })
})
