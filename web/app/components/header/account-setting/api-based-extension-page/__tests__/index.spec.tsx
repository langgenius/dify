import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiBasedExtensionPage } from '../index'

const {
  mockApiBasedExtensionsQuery,
  mockCreateApiBasedExtension,
  mockUpdateApiBasedExtension,
  mockDeleteApiBasedExtension,
  mockWorkspacePermissionKeys,
} = vi.hoisted(() => ({
  mockApiBasedExtensionsQuery: vi.fn(),
  mockCreateApiBasedExtension: vi.fn(),
  mockUpdateApiBasedExtension: vi.fn(),
  mockDeleteApiBasedExtension: vi.fn(),
  mockWorkspacePermissionKeys: {
    current: ['api_extension.manage'] as string[],
  },
}))

vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn((selector: (state: { workspacePermissionKeys: string[] }) => unknown) => selector({
    workspacePermissionKeys: mockWorkspacePermissionKeys.current,
  })),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apiBasedExtension: {
      get: {
        queryOptions: () => ({}),
      },
      post: {
        mutationOptions: () => ({ mutationFn: mockCreateApiBasedExtension }),
      },
      byId: {
        post: {
          mutationOptions: () => ({ mutationFn: mockUpdateApiBasedExtension }),
        },
        delete: {
          mutationOptions: () => ({ mutationFn: mockDeleteApiBasedExtension }),
        },
      },
    },
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => mockApiBasedExtensionsQuery()),
  useMutation: vi.fn((options: { mutationFn: (variables: unknown) => Promise<unknown> }) => ({
    isPending: false,
    mutate: (variables: unknown, mutationOptions?: { onSuccess?: (data: unknown) => void }) => {
      options.mutationFn(variables).then(data => mutationOptions?.onSuccess?.(data))
    },
  })),
}))

describe('ApiBasedExtensionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.current = ['api_extension.manage']
    mockApiBasedExtensionsQuery.mockReturnValue({
      data: [],
      isPending: false,
    })
  })

  describe('Rendering', () => {
    it('should render empty state when no data exists', () => {
      // Arrange
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: [],
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      // Assert
      expect(screen.getByText('common.apiBasedExtension.title'))!.toBeInTheDocument()
    })

    it('should render list of extensions when data exists', () => {
      // Arrange
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'key1' },
        { id: '2', name: 'Extension 2', api_endpoint: 'url2', api_key: 'key2' },
      ]

      mockApiBasedExtensionsQuery.mockReturnValue({
        data: mockData,
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      // Assert
      expect(screen.getByText('Extension 1'))!.toBeInTheDocument()
      expect(screen.getByText('url1'))!.toBeInTheDocument()
      expect(screen.getByText('Extension 2'))!.toBeInTheDocument()
      expect(screen.getByText('url2'))!.toBeInTheDocument()
    })

    it('should pass search and add controls through the layout toolbar', () => {
      // Arrange
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'key1' },
      ]
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: mockData,
        isPending: false,
      })

      // Act
      render(
        <ApiBasedExtensionPage layout={({ body, toolbar }) => (
          <>
            <div data-testid="toolbar">{toolbar}</div>
            <div>{body}</div>
          </>
        )}
        />,
      )

      // Assert
      expect(screen.getByTestId('toolbar')).toContainElement(screen.getByPlaceholderText('common.operation.search'))
      expect(screen.getByTestId('toolbar')).toHaveTextContent('common.apiBasedExtension.add')
      expect(screen.getByText('Extension 1'))!.toBeInTheDocument()
    })

    it('should filter extensions by search keywords', () => {
      // Arrange
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Alpha Extension', api_endpoint: 'https://alpha.example.com', api_key: 'key1' },
        { id: '2', name: 'Beta Extension', api_endpoint: 'https://beta.example.com', api_key: 'key2' },
      ]
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: mockData,
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.change(screen.getByPlaceholderText('common.operation.search'), { target: { value: 'alpha' } })

      // Assert
      expect(screen.getByText('Alpha Extension'))!.toBeInTheDocument()
      expect(screen.queryByText('Beta Extension')).not.toBeInTheDocument()
    })

    it('should render a search empty state without showing the onboarding empty state', () => {
      // Arrange
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Alpha Extension', api_endpoint: 'https://alpha.example.com', api_key: 'key1' },
      ]
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: mockData,
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.change(screen.getByPlaceholderText('common.operation.search'), { target: { value: 'missing' } })

      // Assert
      expect(screen.getByText('common.dataSource.notion.selector.noSearchResult'))!.toBeInTheDocument()
      expect(screen.queryByText('common.apiBasedExtension.title')).not.toBeInTheDocument()
      expect(screen.queryByText('Alpha Extension')).not.toBeInTheDocument()
    })

    it('should handle loading state', () => {
      // Arrange
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: undefined,
        isPending: true,
      })

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      expect(screen.getByRole('status', { name: 'common.loading' }))!.toBeInTheDocument()
      expect(screen.queryByText('common.apiBasedExtension.title')).not.toBeInTheDocument()
      expect(screen.getByText('common.apiBasedExtension.add'))!.toBeInTheDocument()
    })

    it('should disable management actions when api extension permission is missing', () => {
      // Arrange
      mockWorkspacePermissionKeys.current = []
      const extension: ApiBasedExtensionResponse = { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'key1' }
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: [extension],
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)

      // Assert
      expect(screen.getByRole('button', { name: 'common.apiBasedExtension.add' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'common.operation.edit' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'common.operation.delete' })).toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should open modal when clicking add button', () => {
      // Arrange
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: [],
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.add'))

      // Assert
      expect(screen.getByRole('dialog', { name: 'common.apiBasedExtension.modal.title' })).toBeInTheDocument()
    })

    it('should close add modal when create mutation succeeds', async () => {
      // Arrange
      mockCreateApiBasedExtension.mockResolvedValue({
        id: 'new-id',
        name: 'New Ext',
        api_endpoint: 'https://api.test',
        api_key: 'secret-key',
      })
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: [],
        isPending: false,
      })

      // Act
      render(<ApiBasedExtensionPage />)
      fireEvent.click(screen.getByText('common.apiBasedExtension.add'))
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockCreateApiBasedExtension).toHaveBeenCalledWith({
          body: {
            name: 'New Ext',
            api_endpoint: 'https://api.test',
            api_key: 'secret-key',
          },
        })
        expect(screen.queryByRole('dialog', { name: 'common.apiBasedExtension.modal.title' })).not.toBeInTheDocument()
      })
    })

    it('should close edit modal when update mutation succeeds', async () => {
      // Arrange
      const extension: ApiBasedExtensionResponse = { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'long-api-key' }
      mockUpdateApiBasedExtension.mockResolvedValue({ ...extension, name: 'Updated' })
      mockApiBasedExtensionsQuery.mockReturnValue({
        data: [extension],
        isPending: false,
      })

      render(<ApiBasedExtensionPage />)

      // Act - Click edit on the rendered item
      fireEvent.click(screen.getByText('common.operation.edit'))
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockUpdateApiBasedExtension).toHaveBeenCalledWith({
          params: {
            id: '1',
          },
          body: {
            name: 'Extension 1',
            api_endpoint: 'url1',
            api_key: '[__HIDDEN__]',
          },
        })
        expect(screen.queryByRole('dialog', { name: 'common.apiBasedExtension.modal.editTitle' })).not.toBeInTheDocument()
      })
    })
  })
})
