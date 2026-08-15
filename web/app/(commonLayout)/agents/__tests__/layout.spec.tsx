import type { ReactNode } from 'react'
import type { Dependency } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import { useStore as usePluginDependencyStore } from '@/app/components/workflow/plugin-dependency/store'

const mocks = vi.hoisted(() => ({
  guardAgentV2Route: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/install-bundle', () => ({
  default: ({ fromDSLPayload }: { fromDSLPayload: Dependency[] }) => (
    <div role="dialog" aria-label="Install missing plugins">
      {`bundle-size:${fromDSLPayload.length}`}
    </div>
  ),
}))

vi.mock('../feature-guard', () => ({
  guardAgentV2Route: () => mocks.guardAgentV2Route(),
}))

// Access control is covered by agents-access-guard.spec.tsx; this suite is
// about the feature-flag guard only.
vi.mock('../agents-access-guard', () => ({
  AgentsAccessGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

describe('RosterLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePluginDependencyStore.setState({ dependencies: [] })
  })

  it('should render children when Agent v2 is enabled', async () => {
    const { default: RosterLayout } = await import('../layout')

    render(
      <RosterLayout>
        <div>Roster content</div>
      </RosterLayout>,
    )

    expect(mocks.guardAgentV2Route).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Roster content')).toBeInTheDocument()
  })

  it('should show the missing-plugin installer across Agent routes', async () => {
    usePluginDependencyStore.setState({
      dependencies: [
        {
          type: 'marketplace',
          value: {
            organization: 'langgenius',
            plugin: 'sample-plugin',
            version: '1.0.0',
            plugin_unique_identifier: 'langgenius/sample-plugin:1.0.0',
          },
        },
      ],
    })
    const { default: RosterLayout } = await import('../layout')

    render(
      <RosterLayout>
        <div>Agent route content</div>
      </RosterLayout>,
    )

    expect(screen.getByRole('dialog', { name: 'Install missing plugins' })).toHaveTextContent(
      'bundle-size:1',
    )
    expect(screen.getByText('Agent route content')).toBeInTheDocument()
  })

  it('should block rendering when the roster guard throws notFound', async () => {
    mocks.guardAgentV2Route.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })

    const { default: RosterLayout } = await import('../layout')

    expect(() =>
      render(
        <RosterLayout>
          <div>Roster content</div>
        </RosterLayout>,
      ),
    ).toThrow('NEXT_NOT_FOUND')
    expect(mocks.guardAgentV2Route).toHaveBeenCalled()
  })
})
