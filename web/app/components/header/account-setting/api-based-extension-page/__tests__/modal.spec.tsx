import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { act, render as RTLRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDocLink } from '@/context/i18n'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { withConsoleResponses } from '@/test/console/service-responses'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { ApiBasedExtensionModal } from '../modal'

const { mockCreateApiBasedExtension, mockUpdateApiBasedExtension, mockToast } = vi.hoisted(() => {
  const mockCreateApiBasedExtension = vi.fn()
  const mockUpdateApiBasedExtension = vi.fn()
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockCreateApiBasedExtension, mockUpdateApiBasedExtension, mockToast }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apiBasedExtension.post': mockCreateApiBasedExtension,
      'apiBasedExtension.byId.post': mockUpdateApiBasedExtension,
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

describe('ApiBasedExtensionModal', () => {
  const mockOnOpenChange = vi.fn()
  const mockOnSaved = vi.fn()
  const mockDocLink = vi.fn((path?: string) => `https://docs.dify.ai${path || ''}`)
  const mockExtension = (
    overrides: Partial<ApiBasedExtensionResponse> = {},
  ): ApiBasedExtensionResponse => ({
    id: '1',
    name: 'Existing',
    api_endpoint: 'url',
    api_key: 'key',
    ...overrides,
  })

  let queryClient: QueryClient
  const render = (ui: ReactElement) =>
    RTLRender(ui, { wrapper: createQueryClientWrapper(queryClient) })

  const renderModal = (
    props:
      | {
          open?: boolean
        }
      | {
          mode: 'edit'
          apiBasedExtension: ApiBasedExtensionResponse
          open?: boolean
        } = {},
  ) => {
    if ('mode' in props) {
      return render(
        <ApiBasedExtensionModal
          open={props.open ?? true}
          mode="edit"
          apiBasedExtension={props.apiBasedExtension}
          onOpenChange={mockOnOpenChange}
          onSaved={mockOnSaved}
        />,
      )
    }

    return render(
      <ApiBasedExtensionModal
        open={props.open ?? true}
        mode="create"
        onOpenChange={mockOnOpenChange}
        onSaved={mockOnSaved}
      />,
    )
  }
  const expectCloseRequested = () => {
    const calls = mockOnOpenChange.mock.calls
    expect(calls[calls.length - 1]?.[0]).toBe(false)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createTestQueryClient()
    mockCreateApiBasedExtension.mockReset()
    mockUpdateApiBasedExtension.mockReset()
    vi.mocked(useDocLink).mockReturnValue(mockDocLink)
  })

  afterEach(() => queryClient.clear())

  describe('Rendering', () => {
    it('should render correctly for adding a new extension', () => {
      // Act
      renderModal()

      // Assert
      expect(
        screen.getByRole('dialog', { name: 'common.apiBasedExtension.modal.title' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: 'common.apiBasedExtension.modal.name.title' }),
      ).toHaveAttribute('required')
      expect(
        screen.getByRole('textbox', { name: 'common.apiBasedExtension.modal.apiEndpoint.title' }),
      ).toHaveAccessibleDescription('common.apiBasedExtension.link')
      expect(
        screen.getByRole('textbox', { name: 'common.apiBasedExtension.modal.apiKey.title' }),
      ).toHaveAttribute('required')
    })
  })

  describe('Form Submissions', () => {
    it('should call create mutation on save for new extension', async () => {
      const user = userEvent.setup()
      // Arrange
      const newExtension = mockExtension({
        id: 'new-id',
        name: 'New Ext',
        api_endpoint: 'https://api.test',
        api_key: 'secret-key',
      })
      mockCreateApiBasedExtension.mockResolvedValue(newExtension)
      renderModal()

      // Act
      await user.type(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'),
        'New Ext',
      )
      await user.type(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'),
        'https://api.test',
      )
      await user.type(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'),
        'secret-key',
      )
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockCreateApiBasedExtension).toHaveBeenCalledWith({
          body: {
            name: 'New Ext',
            api_endpoint: 'https://api.test',
            api_key: 'secret-key',
          },
        })
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it.each(['success', 'failure'] as const)(
      'prevents duplicate saves until a %s response settles',
      async (outcome) => {
        const user = userEvent.setup()
        const pending = createDeferred<ApiBasedExtensionResponse>()
        mockUpdateApiBasedExtension.mockReturnValueOnce(pending.promise)
        renderModal({ mode: 'edit', apiBasedExtension: mockExtension({ api_key: 'secret-key' }) })
        const save = screen.getByRole('button', { name: 'common.operation.save' })

        await user.click(save)
        await waitFor(() => expect(save).toBeDisabled())
        await user.click(save)
        expect(mockUpdateApiBasedExtension).toHaveBeenCalledOnce()
        expect(mockOnSaved).not.toHaveBeenCalled()

        await act(async () => {
          if (outcome === 'success') pending.resolve(mockExtension())
          else pending.reject(new Error('Unable to save'))
        })
        await waitFor(() => expect(save).toBeEnabled())
        if (outcome === 'success') expect(mockOnSaved).toHaveBeenCalledOnce()
        else expect(mockOnSaved).not.toHaveBeenCalled()
      },
    )

    it('should call update mutation on save for existing extension', async () => {
      const user = userEvent.setup()
      // Arrange
      const data = mockExtension({ api_key: 'long-secret-key' })
      mockUpdateApiBasedExtension.mockResolvedValue({ ...data, name: 'Updated' })
      renderModal({ mode: 'edit', apiBasedExtension: data })

      // Act
      const name = screen.getByRole('textbox', {
        name: 'common.apiBasedExtension.modal.name.title',
      })
      expect(name).toHaveValue('Existing')
      await user.clear(name)
      await user.type(name, 'Updated')
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockUpdateApiBasedExtension).toHaveBeenCalledWith({
          params: {
            id: '1',
          },
          body: {
            name: 'Updated',
            api_endpoint: 'url',
            api_key: '[__HIDDEN__]',
          },
        })
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should call update mutation with new api_key when key is changed', async () => {
      const user = userEvent.setup()
      // Arrange
      const data = mockExtension({ api_key: 'old-key' })
      mockUpdateApiBasedExtension.mockResolvedValue({ ...data, api_key: 'new-longer-key' })
      renderModal({ mode: 'edit', apiBasedExtension: data })

      // Act
      const key = screen.getByRole('textbox', {
        name: 'common.apiBasedExtension.modal.apiKey.title',
      })
      await user.clear(key)
      await user.type(key, 'new-longer-key')
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(mockUpdateApiBasedExtension).toHaveBeenCalledWith({
          params: {
            id: '1',
          },
          body: {
            name: 'Existing',
            api_endpoint: 'url',
            api_key: 'new-longer-key',
          },
        })
      })
    })
  })

  describe('Validation', () => {
    it('should show error if api key is too short', async () => {
      const user = userEvent.setup()
      // Arrange
      renderModal()

      // Act
      await user.type(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'),
        'Ext',
      )
      await user.type(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'),
        'url',
      )
      await user.type(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'),
        '123',
      )
      await user.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(
          screen.getByText('common.apiBasedExtension.modal.apiKey.lengthError'),
        ).toBeInTheDocument()
        expect(
          screen.getByRole('textbox', { name: 'common.apiBasedExtension.modal.apiKey.title' }),
        ).toHaveAttribute('aria-invalid', 'true')
      })
      expect(mockToast.error).not.toHaveBeenCalled()
      expect(mockCreateApiBasedExtension).not.toHaveBeenCalled()
    })
  })

  describe('Interactions', () => {
    it('should request closing when clicking cancel button', async () => {
      const user = userEvent.setup()
      // Arrange
      renderModal()

      // Act
      await user.click(screen.getByText('common.operation.cancel'))

      // Assert
      expectCloseRequested()
    })

    it('should request closing when clicking close button', async () => {
      const user = userEvent.setup()

      // Arrange
      renderModal()

      // Act
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      // Assert
      await waitFor(() => {
        expectCloseRequested()
      })
    })

    it('should request closing when pressing Escape', async () => {
      const user = userEvent.setup()
      // Arrange
      renderModal()

      // Act
      await user.keyboard('{Escape}')

      // Assert
      await waitFor(() => {
        expectCloseRequested()
      })
    })

    it('should keep open when clicking outside the dialog', async () => {
      const user = userEvent.setup()
      // Arrange
      renderModal()

      // Act
      const backdrop = document.querySelector('.bg-background-overlay')
      expect(backdrop).toBeInTheDocument()
      await user.click(backdrop!)

      // Assert
      expect(mockOnOpenChange).not.toHaveBeenCalled()
    })
  })
})
