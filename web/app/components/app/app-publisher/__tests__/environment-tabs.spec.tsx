import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { PublisherEnvironmentTabs } from '../environment-tabs'
import { BUILT_IN_ENVIRONMENT_ID } from '../state'

const environments = [
  { id: 'staging', name: 'Staging' },
  { id: 'pre-release', name: 'Pre-release' },
  { id: 'testing', name: 'Testing' },
  { id: 'demo', name: 'Demo' },
  { id: 'us-prod', name: 'US-Prod' },
] as const

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'common.operation.more': 'More',
    'deployments.card.notDeployed': 'Not deployed',
    'deployments.studio.environments': 'Environments',
    'deployments.studio.moreEnvironments': 'More environments',
    'workflow.nodes.common.memories.builtIn': 'Built-in',
  })
})

function EnvironmentTabsHarness({
  initialJoinedEnvironmentIds = [],
  initialSelectedEnvironmentId = BUILT_IN_ENVIRONMENT_ID,
}: {
  initialJoinedEnvironmentIds?: string[]
  initialSelectedEnvironmentId?: string
}) {
  const [joinedEnvironmentIds, setJoinedEnvironmentIds] = useState(initialJoinedEnvironmentIds)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(initialSelectedEnvironmentId)

  return (
    <PublisherEnvironmentTabs
      environments={environments}
      joinedEnvironmentIds={joinedEnvironmentIds}
      selectedEnvironmentId={selectedEnvironmentId}
      onAddEnvironment={(environmentId) => {
        setJoinedEnvironmentIds((currentEnvironmentIds) => [
          ...currentEnvironmentIds,
          environmentId,
        ])
        setSelectedEnvironmentId(environmentId)
      }}
      onSelectEnvironment={setSelectedEnvironmentId}
    />
  )
}

describe('PublisherEnvironmentTabs', () => {
  it('uses More environments as the only add entry, then adds and selects an environment', async () => {
    const user = userEvent.setup()
    render(<EnvironmentTabsHarness />)

    const environmentGroup = screen.getByRole('group', { name: 'Environments' })
    expect(within(environmentGroup).queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(within(environmentGroup).getByRole('button', { name: 'Built-in' })).toHaveAttribute(
      'aria-current',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'More environments' }))

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Not deployed')).toBeInTheDocument()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Staging', 'Pre-release', 'Testing', 'Demo', 'US-Prod'])

    await user.click(within(menu).getByRole('menuitem', { name: 'Staging' }))

    expect(screen.getByRole('button', { name: 'Staging' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Built-in' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('keeps fixed visible environments in place and marks a selected overflow environment', async () => {
    const user = userEvent.setup()
    render(
      <EnvironmentTabsHarness
        initialJoinedEnvironmentIds={['staging', 'pre-release', 'testing']}
      />,
    )

    const environmentGroup = screen.getByRole('group', { name: 'Environments' })
    expect(
      within(environmentGroup)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Built-in', 'Staging', 'Pre-release', 'More'])

    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Testing' }))

    expect(
      within(environmentGroup)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Built-in', 'Staging', 'Pre-release', 'Testing'])
    expect(screen.getByRole('button', { name: 'Testing' })).toHaveAttribute('aria-current', 'true')
    expect(
      within(environmentGroup)
        .getAllByRole('button')
        .filter((button) => button.hasAttribute('aria-current'))
        .map((button) => button.textContent),
    ).toEqual(['Testing'])

    await user.click(screen.getByRole('button', { name: 'Testing' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Testing' })).not.toBeInTheDocument()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Demo', 'US-Prod'])
  })

  it('removes the not-deployed section when every environment has joined', async () => {
    const user = userEvent.setup()
    render(
      <EnvironmentTabsHarness
        initialJoinedEnvironmentIds={environments.map((environment) => environment.id)}
        initialSelectedEnvironmentId="testing"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Testing' }))

    const menu = screen.getByRole('menu')
    expect(within(menu).queryByText('Not deployed')).not.toBeInTheDocument()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Demo', 'US-Prod'])
  })

  it('does not render More when every joined environment fits', () => {
    render(
      <PublisherEnvironmentTabs
        environments={environments.slice(0, 2)}
        joinedEnvironmentIds={['staging', 'pre-release']}
        selectedEnvironmentId={BUILT_IN_ENVIRONMENT_ID}
        onAddEnvironment={vi.fn()}
        onSelectEnvironment={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Built-in',
      'Staging',
      'Pre-release',
    ])
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More environments' })).not.toBeInTheDocument()
  })

  it('shows the full environment name in a tooltip when its button is truncated', async () => {
    const user = userEvent.setup()
    const longEnvironment = {
      id: 'long-production',
      name: 'Production environment with a very long name',
    }
    render(
      <PublisherEnvironmentTabs
        environments={[longEnvironment]}
        joinedEnvironmentIds={[longEnvironment.id]}
        selectedEnvironmentId={longEnvironment.id}
        onAddEnvironment={vi.fn()}
        onSelectEnvironment={vi.fn()}
      />,
    )

    await user.hover(screen.getByRole('button', { name: longEnvironment.name }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(longEnvironment.name)
  })
})
