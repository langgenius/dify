import { screen } from '@testing-library/react'
import { vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import EnvNav from '../index'

const renderEnvNav = (currentEnv: string) =>
  renderWithConsoleQuery(<EnvNav />, {
    accountProfileMeta: { currentEnv },
  })

describe('EnvNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render null when environment is PRODUCTION', () => {
    const { container } = renderEnvNav('PRODUCTION')
    expect(container.firstChild).toBeNull()
  })

  it('should render TESTING tag and icon when environment is TESTING', () => {
    renderEnvNav('TESTING')
    expect(screen.getByText('common.environment.testing')).toBeInTheDocument()
  })

  it('should render DEVELOPMENT tag and icon when environment is DEVELOPMENT', () => {
    renderEnvNav('DEVELOPMENT')
    expect(screen.getByText('common.environment.development')).toBeInTheDocument()
  })
})
