import type { ReactNode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import List from '../index'

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockConsoleState = {
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
}
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}))

// Mock app context

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleState)
})

// Mock useDocumentTitle hook
vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

// Mock useFormatTimeFromNow hook
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => new Date(timestamp).toLocaleDateString(),
  }),
}))

// Mock useKnowledge hook
vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'High Quality',
  }),
}))

const { getDatasets } = vi.hoisted(() => ({ getDatasets: vi.fn() }))
const datasetPage = (total = 1) => ({
  data: total ? [createDatasetFixture()] : [],
  total,
  page: 1,
  limit: 30,
  has_more: false,
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.get': getDatasets,
      'datasets.apiBaseInfo.get': () =>
        Promise.resolve({ api_base_url: 'https://api.example.com' }),
    }),
  }
})

// Mock Datasets component
vi.mock('../datasets', () => ({
  default: ({
    datasetList,
    emptyElement,
  }: {
    datasetList?: { pages: Array<{ total?: number }> }
    emptyElement?: ReactNode
  }) => (
    <div data-testid="datasets-component">
      <span data-testid="dataset-total">{datasetList?.pages[0]?.total}</span>
      {emptyElement}
    </div>
  ),
}))

// Mock ExternalAPIPanel component
vi.mock('../../external-api/external-api-panel', () => ({
  default: ({
    canManageExternalKnowledgeApi,
    onClose,
  }: {
    canManageExternalKnowledgeApi: boolean
    onClose: () => void
  }) => (
    <div
      data-testid="external-api-panel"
      data-can-manage-external-knowledge-api={canManageExternalKnowledgeApi}
    >
      <button onClick={onClose}>Close Panel</button>
    </div>
  ),
}))

// Service API management has its own integration coverage.
vi.mock('@/app/components/datasets/extra-info/service-api', () => ({
  ServiceApi: () => null,
}))

// Mock TagManagementModal
vi.mock('@/features/tag-management/components/tag-management-modal', () => ({
  TagManagementModal: ({ show }: { show: boolean }) =>
    show ? <div data-testid="tag-management-modal" /> : null,
}))

// Mock TagFilter
vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: ({
    onChange,
    onOpenTagManagement,
  }: {
    value: string[]
    onChange: (val: string[]) => void
    onOpenTagManagement: () => void
  }) => (
    <div data-testid="tag-filter">
      <button onClick={() => onChange(['tag-1', 'tag-2'])}>Select Tags</button>
      <button onClick={onOpenTagManagement}>Manage Tags</button>
    </div>
  ),
}))

describe('List', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    mockConsoleState = {
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: true,
      workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    }
    getDatasets.mockResolvedValue(datasetPage(1))
  })

  describe('Rendering', () => {
    it('should hide external API panel button without dataset.external.connect', () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }

      render(<List />)

      expect(screen.queryByText(/externalAPIPanelTitle/)).not.toBeInTheDocument()
      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render first empty state when dataset.create_and_management is available', async () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: ['dataset.create_and_management'],
      }
      getDatasets.mockResolvedValue(datasetPage(0))

      render(<List />)

      expect(await screen.findByText('dataset.firstEmpty.title')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
      ).toHaveAttribute('href', '/datasets/create-from-pipeline')
    })

    it('should render a permission empty state without dataset creation permissions', async () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: true,
        workspacePermissionKeys: [],
      }
      getDatasets.mockResolvedValue(datasetPage(0))

      render(<List />)

      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
      expect(await screen.findByText('dataset.firstEmpty.noCreatePermission')).toBeInTheDocument()
      expect(screen.queryByTestId('datasets-component')).not.toBeInTheDocument()
    })

    it('should not render first empty state before the first dataset page resolves', async () => {
      getDatasets.mockReturnValue(new Promise(() => {}))

      render(<List />)

      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
    })

    it('should keep the regular list for empty filtered results', async () => {
      getDatasets.mockImplementation(({ query }) =>
        Promise.resolve(datasetPage(query.include_all ? 0 : 1)),
      )

      render(<List />)

      await userEvent.setup().click(screen.getByRole('checkbox', { name: 'dataset.allKnowledge' }))

      expect(screen.getByTestId('datasets-component')).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('dataset.filterEmpty.noKnowledge'),
      )
      expect(screen.queryByText('dataset.firstEmpty.title')).not.toBeInTheDocument()
    })

    it('announces empty search results only after the current filters finish loading', async () => {
      const user = userEvent.setup()
      const response = createDeferred<ReturnType<typeof datasetPage>>()
      getDatasets.mockResolvedValueOnce(datasetPage()).mockReturnValue(response.promise)
      render(<List />)
      await waitFor(() => expect(screen.getByTestId('dataset-total')).toHaveTextContent('1'))
      const status = screen.getByRole('status')
      const search = screen.getByRole('searchbox')
      await user.type(search, 'missing')
      expect(status).toBeEmptyDOMElement()
      await waitFor(() =>
        expect(getDatasets).toHaveBeenLastCalledWith({
          query: expect.objectContaining({ keyword: 'missing' }),
        }),
      )
      expect(screen.getByTestId('dataset-total')).toHaveTextContent('1')
      expect(status).toBeEmptyDOMElement()
      await act(async () => response.resolve(datasetPage(0)))
      await waitFor(() => expect(status).toHaveTextContent('dataset.filterEmpty.noKnowledge'))
      expect(screen.getByRole('status')).toBe(status)
      expect(search).toHaveFocus()
      await user.type(search, ' again')
      expect(status).toBeEmptyDOMElement()
    })
  })

  describe('Branch Coverage', () => {
    it('should close ExternalAPIPanel when onClose is called', () => {
      render(<List />)

      fireEvent.click(screen.getByText(/externalAPIPanelTitle/))
      fireEvent.click(screen.getByText('Close Panel'))

      expect(screen.queryByTestId('external-api-panel')).not.toBeInTheDocument()
    })

    it('should show TagManagementModal when tag management is opened', () => {
      render(<List />)
      fireEvent.click(screen.getByText('Manage Tags'))

      expect(screen.getByTestId('tag-management-modal')).toBeInTheDocument()
    })

    it('should not show include all checkbox when not workspace owner', async () => {
      mockConsoleState = {
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
      }

      render(<List />)

      expect(
        screen.queryByRole('checkbox', { name: 'dataset.allKnowledge' }),
      ).not.toBeInTheDocument()
    })
  })
})
