import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { EnvironmentBadge } from '../environment-badge'

const renderEnvironmentBadge = (currentEnv: string | null) =>
  renderWithConsoleQuery(<EnvironmentBadge />, {
    accountProfileMeta: { currentEnv },
  })

describe('EnvironmentBadge', () => {
  it.each(['PRODUCTION', null])('should render nothing when environment is %s', (currentEnv) => {
    const { container } = renderEnvironmentBadge(currentEnv)
    expect(container).toBeEmptyDOMElement()
  })

  it('should render the testing label when environment is TESTING', () => {
    renderEnvironmentBadge('TESTING')
    expect(screen.getByText('common.environment.testing')).toBeInTheDocument()
  })

  it('should render the development label when environment is DEVELOPMENT', () => {
    renderEnvironmentBadge('DEVELOPMENT')
    expect(screen.getByText('common.environment.development')).toBeInTheDocument()
  })
})
