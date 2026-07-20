import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  guardAgentV2Route: vi.fn(),
}))

vi.mock('../feature-guard', () => ({
  guardAgentV2Route: () => mocks.guardAgentV2Route(),
}))

describe('RosterLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
