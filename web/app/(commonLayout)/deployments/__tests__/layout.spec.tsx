import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  ensureQueryData: vi.fn(),
  systemFeaturesQueryOptions: { queryKey: ['console', 'system-features'] },
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => ({
    ensureQueryData: mocks.ensureQueryData,
  }),
}))

vi.mock('@/features/system-features/server', () => ({
  serverSystemFeaturesQueryOptions: () => mocks.systemFeaturesQueryOptions,
}))

vi.mock('@/features/deployments/deploy-drawer', () => ({
  DeployDrawer: () => <div>Deploy drawer</div>,
}))

vi.mock('@/next/navigation', () => ({
  notFound: () => mocks.notFound(),
}))

const renderDeploymentsLayout = async (children: ReactNode) => {
  const { default: DeploymentsLayout } = await import('../layout')
  const element = await DeploymentsLayout({ children })
  render(element as ReactElement)
}

describe('DeploymentsLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureQueryData.mockResolvedValue({ enable_app_deploy: true })
  })

  it('should render deployments content and drawer when app deploy is enabled', async () => {
    await renderDeploymentsLayout(<div>Deployments content</div>)

    expect(mocks.ensureQueryData).toHaveBeenCalledWith(mocks.systemFeaturesQueryOptions)
    expect(screen.getByText('Deployments content')).toBeInTheDocument()
    expect(screen.getByText('Deploy drawer')).toBeInTheDocument()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('should trigger notFound when app deploy is disabled', async () => {
    mocks.ensureQueryData.mockResolvedValue({ enable_app_deploy: false })
    const { default: DeploymentsLayout } = await import('../layout')

    await expect(
      DeploymentsLayout({
        children: <div>Deployments content</div>,
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
