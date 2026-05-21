import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatasetsLayout from './layout'

const mockReplace = vi.fn()
const mockUseAppContext = vi.fn()
let mockPathname = '/datasets'

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => mockPathname,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
  useSelector: (selector: (state: AppContextMock) => unknown) => selector(mockUseAppContext()),
}))

vi.mock('@/context/external-api-panel-context', () => ({
  ExternalApiPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/context/external-knowledge-api-context', () => ({
  ExternalKnowledgeApiProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

type AppContextMock = {
  isCurrentWorkspaceEditor: boolean
  isCurrentWorkspaceDatasetOperator: boolean
  isLoadingCurrentWorkspace: boolean
  isLoadingWorkspacePermissionKeys: boolean
  workspacePermissionKeys: string[]
  currentWorkspace: {
    id: string
  }
}

const baseContext: AppContextMock = {
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceDatasetOperator: false,
  isLoadingCurrentWorkspace: false,
  isLoadingWorkspacePermissionKeys: false,
  workspacePermissionKeys: ['page.datasets.access'],
  currentWorkspace: {
    id: 'workspace-1',
  },
}

const setAppContext = (overrides: Partial<AppContextMock> = {}) => {
  mockUseAppContext.mockReturnValue({
    ...baseContext,
    ...overrides,
  })
}

describe('DatasetsLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/datasets'
    setAppContext()
  })

  it('should render loading when workspace is still loading', () => {
    setAppContext({
      isLoadingCurrentWorkspace: true,
      currentWorkspace: { id: '' },
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('datasets')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should render loading while workspace permission keys are loading', () => {
    setAppContext({
      isLoadingWorkspacePermissionKeys: true,
      workspacePermissionKeys: [],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('datasets')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect users without dataset page access to /apps', async () => {
    setAppContext({
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceDatasetOperator: true,
      workspacePermissionKeys: ['dataset.create', 'dataset.external.connect'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.queryByText('datasets')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('should render children when workspace has dataset page access', () => {
    setAppContext({
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceDatasetOperator: false,
      workspacePermissionKeys: ['page.datasets.access'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByText('datasets')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it.each([
    '/datasets/create',
    '/datasets/create-from-pipeline',
  ])('should redirect direct dataset creation route to /datasets without dataset.create: %s', async (pathname) => {
    mockPathname = pathname
    setAppContext({
      workspacePermissionKeys: ['page.datasets.access'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.queryByText('datasets')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })

  it('should render direct dataset creation route when workspace has dataset.create', () => {
    mockPathname = '/datasets/create'
    setAppContext({
      workspacePermissionKeys: ['page.datasets.access', 'dataset.create'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByText('datasets')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect direct external dataset connection route to /datasets without dataset.external.connect', async () => {
    mockPathname = '/datasets/connect'
    setAppContext({
      workspacePermissionKeys: ['page.datasets.access'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.queryByText('datasets')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })
  })

  it('should render direct external dataset connection route when workspace has dataset.external.connect', () => {
    mockPathname = '/datasets/connect'
    setAppContext({
      workspacePermissionKeys: ['page.datasets.access', 'dataset.external.connect'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByText('datasets')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
