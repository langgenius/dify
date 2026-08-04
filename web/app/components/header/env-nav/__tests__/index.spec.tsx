import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { render } from '@/test/console/render'
import EnvNav from '../index'

const mockConsoleState = vi.hoisted(() => ({
  current: {} as Partial<ConsoleStateFixture>,
}))
const mockConsoleStateReader = vi.hoisted(() => vi.fn())

vi.mock('@/context/version-state', async () => {
  const { createVersionStateModuleMock } = await import('@/test/console/state-fixture')
  return createVersionStateModuleMock(() => mockConsoleState.current)
})

describe('EnvNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render null when environment is PRODUCTION', () => {
    const consoleState = {
      langGeniusVersionInfo: {
        current_env: 'PRODUCTION',
      },
    } as unknown as ConsoleStateFixture
    mockConsoleState.current = consoleState
    mockConsoleStateReader.mockReturnValue(consoleState)

    const { container } = render(<EnvNav />)
    expect(container.firstChild).toBeNull()
  })

  it('should render TESTING tag and icon when environment is TESTING', () => {
    const consoleState = {
      langGeniusVersionInfo: {
        current_env: 'TESTING',
      },
    } as unknown as ConsoleStateFixture
    mockConsoleState.current = consoleState
    mockConsoleStateReader.mockReturnValue(consoleState)

    render(<EnvNav />)
    expect(screen.getByText('common.environment.testing')).toBeInTheDocument()
  })

  it('should render DEVELOPMENT tag and icon when environment is DEVELOPMENT', () => {
    const consoleState = {
      langGeniusVersionInfo: {
        current_env: 'DEVELOPMENT',
      },
    } as unknown as ConsoleStateFixture
    mockConsoleState.current = consoleState
    mockConsoleStateReader.mockReturnValue(consoleState)

    render(<EnvNav />)
    expect(screen.getByText('common.environment.development')).toBeInTheDocument()
  })
})
