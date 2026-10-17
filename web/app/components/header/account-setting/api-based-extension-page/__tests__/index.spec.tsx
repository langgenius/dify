import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ApiBasedExtensionPage } from '../index'

const {
  listExtensions,
  mockCreateApiBasedExtension,
  mockUpdateApiBasedExtension,
  mockDeleteApiBasedExtension,
  mockWorkspacePermissionKeys,
} = vi.hoisted(() => ({
  listExtensions: vi.fn(),
  mockCreateApiBasedExtension: vi.fn(),
  mockUpdateApiBasedExtension: vi.fn(),
  mockDeleteApiBasedExtension: vi.fn(),
  mockWorkspacePermissionKeys: {
    current: ['api_extension.manage'] as string[],
  },
}))

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    workspacePermissionKeys: mockWorkspacePermissionKeys.current,
  })

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apiBasedExtension.get': listExtensions,
      'apiBasedExtension.post': mockCreateApiBasedExtension,
      'apiBasedExtension.byId.post': mockUpdateApiBasedExtension,
      'apiBasedExtension.byId.delete': mockDeleteApiBasedExtension,
    }),
  }
})

describe('ApiBasedExtensionPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWorkspacePermissionKeys.current = ['api_extension.manage']
    listExtensions.mockResolvedValue([])
  })

  describe('Rendering', () => {
    it('should render empty state when no data exists', async () => {
      listExtensions.mockResolvedValue([])

      render(<ApiBasedExtensionPage />)

      expect(await screen.findByText('common.apiBasedExtension.title')).toBeInTheDocument()
    })

    it('should render list of extensions when data exists', async () => {
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'key1' },
        { id: '2', name: 'Extension 2', api_endpoint: 'url2', api_key: 'key2' },
      ]

      listExtensions.mockResolvedValue(mockData)

      render(<ApiBasedExtensionPage />)

      expect(await screen.findByText('Extension 1')).toBeInTheDocument()
      expect(await screen.findByText('url1')).toBeInTheDocument()
      expect(await screen.findByText('Extension 2')).toBeInTheDocument()
      expect(await screen.findByText('url2')).toBeInTheDocument()
    })

    it('should pass search and add controls through the layout toolbar', async () => {
      const mockData: ApiBasedExtensionResponse[] = [
        { id: '1', name: 'Extension 1', api_endpoint: 'url1', api_key: 'key1' },
      ]
      listExtensions.mockResolvedValue(mockData)

      render(
        <ApiBasedExtensionPage
          layout={({ body, toolbar }) => (
            <>
              <div data-testid="toolbar">{toolbar}</div>
              <div>{body}</div>
            </>
          )}
        />,
      )

      expect(screen.getByTestId('toolbar')).toContainElement(
        screen.getByPlaceholderText('common.operation.search'),
      )
      expect(screen.getByTestId('toolbar')).toHaveTextContent('common.apiBasedExtension.add')
      expect(await screen.findByText('Extension 1')).toBeInTheDocument()
    })

    it('should filter extensions by search keywords', async () => {
      const mockData: ApiBasedExtensionResponse[] = [
        {
          id: '1',
          name: 'Alpha Extension',
          api_endpoint: 'https://alpha.example.com',
          api_key: 'key1',
        },
        {
          id: '2',
          name: 'Beta Extension',
          api_endpoint: 'https://beta.example.com',
          api_key: 'key2',
        },
      ]
      listExtensions.mockResolvedValue(mockData)

      render(<ApiBasedExtensionPage />)
      fireEvent.change(screen.getByPlaceholderText('common.operation.search'), {
        target: { value: 'alpha' },
      })

      expect(await screen.findByText('Alpha Extension')).toBeInTheDocument()
      expect(screen.queryByText('Beta Extension')).not.toBeInTheDocument()
    })

    it('should announce an empty search result without showing the onboarding empty state', async () => {
      const mockData: ApiBasedExtensionResponse[] = [
        {
          id: '1',
          name: 'Alpha Extension',
          api_endpoint: 'https://alpha.example.com',
          api_key: 'key1',
        },
      ]
      listExtensions.mockResolvedValue(mockData)

      render(<ApiBasedExtensionPage />)
      const user = userEvent.setup()
      await user.type(screen.getByPlaceholderText('common.operation.search'), 'missing')

      expect(screen.getByRole('status')).toHaveTextContent(
        'common.dataSource.notion.selector.noSearchResult',
      )
      expect(screen.queryByText('common.apiBasedExtension.title')).not.toBeInTheDocument()
      expect(screen.queryByText('Alpha Extension')).not.toBeInTheDocument()
    })

    it('should handle loading state', () => {
      listExtensions.mockImplementation(() => new Promise(() => {}))

      render(<ApiBasedExtensionPage />)

      expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
      expect(screen.queryByText('common.apiBasedExtension.title')).not.toBeInTheDocument()
      expect(screen.getByText('common.apiBasedExtension.add')).toBeInTheDocument()
    })

    it('should disable management actions when api extension permission is missing', async () => {
      mockWorkspacePermissionKeys.current = []
      const extension: ApiBasedExtensionResponse = {
        id: '1',
        name: 'Extension 1',
        api_endpoint: 'url1',
        api_key: 'key1',
      }
      listExtensions.mockResolvedValue([extension])

      render(<ApiBasedExtensionPage />)

      expect(screen.getByRole('button', { name: 'common.apiBasedExtension.add' })).toBeDisabled()
      expect(
        await screen.findByRole('button', { name: /common\.operation\.edit.*Extension 1/i }),
      ).toBeDisabled()
      expect(
        await screen.findByRole('button', { name: /common\.operation\.delete.*Extension 1/i }),
      ).toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('should close add modal when create mutation succeeds', async () => {
      mockCreateApiBasedExtension.mockResolvedValue({
        id: 'new-id',
        name: 'New Ext',
        api_endpoint: 'https://api.test',
        api_key: 'secret-key',
      })
      listExtensions.mockResolvedValue([])

      render(<ApiBasedExtensionPage />)
      await userEvent.setup().click(screen.getByText('common.apiBasedExtension.add'))
      fireEvent.change(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'),
        { target: { value: 'New Ext' } },
      )
      fireEvent.change(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'),
        { target: { value: 'https://api.test' } },
      )
      fireEvent.change(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'),
        { target: { value: 'secret-key' } },
      )
      await userEvent.setup().click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(mockCreateApiBasedExtension).toHaveBeenCalledWith({
          body: {
            name: 'New Ext',
            api_endpoint: 'https://api.test',
            api_key: 'secret-key',
          },
        })
        expect(
          screen.queryByRole('dialog', { name: 'common.apiBasedExtension.modal.title' }),
        ).not.toBeInTheDocument()
      })
    })

    it('should close edit modal when update mutation succeeds', async () => {
      const extension: ApiBasedExtensionResponse = {
        id: '1',
        name: 'Extension 1',
        api_endpoint: 'url1',
        api_key: 'long-api-key',
      }
      mockUpdateApiBasedExtension.mockResolvedValue({ ...extension, name: 'Updated' })
      listExtensions.mockResolvedValue([extension])

      render(<ApiBasedExtensionPage />)

      await userEvent.setup().click(await screen.findByText('common.operation.edit'))
      const name = screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder')
      await userEvent.setup().clear(name)
      await userEvent.setup().type(name, 'Updated')
      await userEvent.setup().click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(mockUpdateApiBasedExtension).toHaveBeenCalledWith({
          params: {
            id: '1',
          },
          body: {
            name: 'Updated',
            api_endpoint: 'url1',
            api_key: '[__HIDDEN__]',
          },
        })
        expect(
          screen.queryByRole('dialog', { name: 'common.apiBasedExtension.modal.editTitle' }),
        ).not.toBeInTheDocument()
      })
    })
  })
})
