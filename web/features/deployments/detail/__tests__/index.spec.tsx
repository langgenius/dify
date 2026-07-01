import type { Mock } from 'vitest'
import { useSuspenseQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai'
import { NextRouteStateBridge } from '@/app/components/next-route-state'
import { useAppContext } from '@/context/app-context'
import { useParams, usePathname } from '@/next/navigation'
import { InstanceDetail } from '..'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: vi.fn(),
  }
})

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

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

vi.mock('@/app/components/detail-sidebar', () => ({
  DetailSidebarFrame: () => <aside aria-label="Detail sidebar" />,
}))

vi.mock('../deployment-sidebar', () => ({
  DeploymentDetailTop: () => null,
  DeploymentDetailSection: () => null,
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

function renderInstanceDetail({
  isCurrentWorkspaceDatasetOperator = false,
  isCurrentWorkspaceEditor = true,
  enableAppDeploy = true,
} = {}) {
  ;(usePathname as Mock).mockReturnValue('/deployments/app-instance-1/overview')
  ;(useParams as Mock).mockReturnValue({
    appInstanceId: 'app-instance-1',
  })
  ;(useAppContext as Mock).mockReturnValue({
    isCurrentWorkspaceDatasetOperator,
    isCurrentWorkspaceEditor,
  })
  ;(useSuspenseQuery as Mock).mockReturnValue({
    data: {
      enable_app_deploy: enableAppDeploy,
    },
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

  it('should own the skip target when deployment detail navigation is available', () => {
    renderInstanceDetail()

    const main = screen.getByRole('main')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(main).toHaveAttribute('id', 'main-content')
    expect(main).toHaveTextContent('Deployment detail content')
    expect(screen.getByRole('complementary', { name: 'Detail sidebar' })).toBeInTheDocument()
  })

  it.each([
    ['dataset operator', { isCurrentWorkspaceDatasetOperator: true }],
    ['non-editor workspace', { isCurrentWorkspaceEditor: false }],
    ['disabled deployment feature', { enableAppDeploy: false }],
  ])('should defer the skip target to the global layout for %s', (_label, options) => {
    renderInstanceDetail({
      ...options,
    })

    expect(screen.getByText('Deployment detail content')).toBeInTheDocument()
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Detail sidebar' })).not.toBeInTheDocument()
  })
})
