import type { Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { NextRouteStateBridge } from '@/app/components/next-route-state'
import { useParams, usePathname } from '@/next/navigation'
import { InstanceDetail } from '..'
import { DeploymentDetailTop } from '../deployment-sidebar'

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    useParams: vi.fn(),
    usePathname: vi.fn(),
  }
})

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('../api-tokens/developer-api-header-switch', () => ({
  DeveloperApiHeaderSwitch: () => null,
}))

vi.mock('../instances/header-actions/new-deployment-button', () => ({
  NewDeploymentHeaderAction: () => null,
}))

vi.mock('../../create-release', () => ({
  CreateReleaseControl: () => null,
}))

function renderInstanceDetail() {
  ;(usePathname as Mock).mockReturnValue('/deployments/app-instance-1/overview')
  ;(useParams as Mock).mockReturnValue({
    appInstanceId: 'app-instance-1',
  })

  return render(
    <JotaiProvider>
      <NextRouteStateBridge>
        <InstanceDetail>
          <div>Deployment detail content</div>
        </InstanceDetail>
      </NextRouteStateBridge>
    </JotaiProvider>,
  )
}

describe('InstanceDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render detail content without owning navigation landmarks', () => {
    renderInstanceDetail()

    expect(screen.getByText('Deployment detail content')).toBeInTheDocument()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Detail sidebar' })).not.toBeInTheDocument()
  })
})

describe('DeploymentDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the combined home control to home', () => {
    render(
      <JotaiProvider>
        <DeploymentDetailTop />
      </JotaiProvider>,
    )

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'common.menus.deployments' })).toHaveAttribute(
      'href',
      '/deployments',
    )
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })
})
