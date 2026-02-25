import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DatasetsLayout from './layout'

const mockReplace = vi.fn()
const mockUseAppContext = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
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
  currentWorkspace: {
    id: string
  }
}

const baseContext: AppContextMock = {
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceDatasetOperator: false,
  isLoadingCurrentWorkspace: false,
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
    setAppContext()
  })

  it('should render loading when workspace is still loading', () => {
    setAppContext({
      isLoadingCurrentWorkspace: true,
      currentWorkspace: { id: '' },
    })

    render((
      <DatasetsLayout>
        <div data-testid="datasets-content">datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('datasets-content')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('should redirect non-editor and non-dataset-operator users to /apps', async () => {
    setAppContext({
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceDatasetOperator: false,
    })

    render((
      <DatasetsLayout>
        <div data-testid="datasets-content">datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.queryByTestId('datasets-content')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('should render children for dataset operators', () => {
    setAppContext({
      isCurrentWorkspaceEditor: false,
      isCurrentWorkspaceDatasetOperator: true,
    })

    render((
      <DatasetsLayout>
        <div data-testid="datasets-content">datasets</div>
      </DatasetsLayout>
    ))

    expect(screen.getByTestId('datasets-content')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
