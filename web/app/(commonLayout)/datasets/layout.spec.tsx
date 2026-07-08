import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatasetsLayout from './layout'

const mockReplace = vi.fn()
const mockUseAppContext = vi.fn()
let mockPathname = '/datasets'
let mockExternalKnowledgeApiProviderEnabled: boolean | undefined

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

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockUseAppContext())
})

vi.mock('@/context/external-api-panel-context', () => ({
  ExternalApiPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

vi.mock('@/context/external-knowledge-api-context', () => ({
  ExternalKnowledgeApiProvider: ({ children, enabled }: { children: ReactNode, enabled?: boolean }) => {
    mockExternalKnowledgeApiProviderEnabled = enabled
    return <>{children}</>
  },
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
  workspacePermissionKeys: [],
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
    mockExternalKnowledgeApiProviderEnabled = undefined
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

  it('should render children without a page-level dataset permission', () => {
    setAppContext({
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceDatasetOperator: true,
      workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByText('datasets')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should render children on the dataset list route without dataset permissions', () => {
    setAppContext({
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceDatasetOperator: false,
      workspacePermissionKeys: [],
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
  ])('should redirect direct dataset creation route to /datasets without dataset.create_and_management: %s', async (pathname) => {
    mockPathname = pathname
    setAppContext({
      workspacePermissionKeys: [],
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

  it('should render direct dataset creation route when workspace has dataset.create_and_management', () => {
    mockPathname = '/datasets/create'
    setAppContext({
      workspacePermissionKeys: ['dataset.create_and_management'],
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
      workspacePermissionKeys: [],
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
      workspacePermissionKeys: ['dataset.external.connect'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByText('datasets')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should disable external knowledge API queries without dataset.external.connect', () => {
    setAppContext({
      workspacePermissionKeys: [],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(mockExternalKnowledgeApiProviderEnabled).toBe(false)
  })

  it('should enable external knowledge API queries with dataset.external.connect', () => {
    setAppContext({
      workspacePermissionKeys: ['dataset.external.connect'],
    })

    render((
      <DatasetsLayout>
        <div>datasets</div>
      </DatasetsLayout>
    ))

    expect(mockExternalKnowledgeApiProviderEnabled).toBe(true)
  })
})
