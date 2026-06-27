import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  guardDeploymentsRoute: vi.fn(),
}))

vi.mock('../feature-guard', () => ({
  guardDeploymentsRoute: () => mocks.guardDeploymentsRoute(),
}))

vi.mock('@/features/deployments/deploy-drawer', () => ({
  DeployDrawer: () => <div>Deploy drawer</div>,
}))

describe('DeploymentsLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render children when deployments are enabled', async () => {
    const { default: DeploymentsLayout } = await import('../layout')

    render(await DeploymentsLayout({
      children: <div>Deployments content</div>,
    }))

    expect(mocks.guardDeploymentsRoute).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Deployments content')).toBeInTheDocument()
    expect(screen.getByText('Deploy drawer')).toBeInTheDocument()
  })

  it('should block rendering when the deployments guard throws notFound', async () => {
    mocks.guardDeploymentsRoute.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })

    const { default: DeploymentsLayout } = await import('../layout')

    await expect(DeploymentsLayout({
      children: <div>Deployments content</div>,
    })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.guardDeploymentsRoute).toHaveBeenCalledTimes(1)
  })
})
