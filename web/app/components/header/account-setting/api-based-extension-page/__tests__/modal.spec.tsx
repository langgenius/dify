import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import { fireEvent, render as RTLRender, screen, waitFor } from '@testing-library/react'
import * as reactI18next from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { withSelectorKey } from '@/test/i18n-mock'
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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apiBasedExtension: {
      post: {
        mutationOptions: () => ({ mutationFn: mockCreateApiBasedExtension }),
      },
      byId: {
        post: {
          mutationOptions: () => ({ mutationFn: mockUpdateApiBasedExtension }),
        },
      },
    },
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((options: { mutationFn: (variables: unknown) => Promise<unknown> }) => ({
    isPending: false,
    mutate: (variables: unknown, mutationOptions?: { onSuccess?: (data: unknown) => void }) => {
      options.mutationFn(variables).then((data) => mutationOptions?.onSuccess?.(data))
    },
  })),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
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

  const render = (ui: ReactElement) => RTLRender(ui)
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
    vi.mocked(useDocLink).mockReturnValue(mockDocLink)
  })

  describe('Rendering', () => {
    it('should render correctly for adding a new extension', () => {
      // Act
      renderModal()

      // Assert
      expect(
        screen.getByRole('dialog', { name: 'common.apiBasedExtension.modal.title' }),
      ).toBeInTheDocument()
      expect(screen.getByText('common.apiBasedExtension.modal.title')).toBeInTheDocument()
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

    it('should render correctly for editing an existing extension', () => {
      // Arrange
      const data = mockExtension()

      // Act
      renderModal({ mode: 'edit', apiBasedExtension: data })

      // Assert
      expect(screen.getByText('common.apiBasedExtension.modal.editTitle')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Existing')).toBeInTheDocument()
      expect(screen.getByDisplayValue('url')).toBeInTheDocument()
      expect(screen.getByDisplayValue('key')).toBeInTheDocument()
    })

    it('should not render dialog content when closed', () => {
      // Act
      renderModal({ open: false })

      // Assert
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Form Submissions', () => {
    it('should call create mutation on save for new extension', async () => {
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
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should call update mutation on save for existing extension', async () => {
      // Arrange
      const data = mockExtension({ api_key: 'long-secret-key' })
      mockUpdateApiBasedExtension.mockResolvedValue({ ...data, name: 'Updated' })
      renderModal({ mode: 'edit', apiBasedExtension: data })

      // Act
      fireEvent.change(screen.getByDisplayValue('Existing'), { target: { value: 'Updated' } })
      fireEvent.click(screen.getByText('common.operation.save'))

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
        expect(mockToast.success).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully')
        expect(mockOnSaved).toHaveBeenCalled()
      })
    })

    it('should call update mutation with new api_key when key is changed', async () => {
      // Arrange
      const data = mockExtension({ api_key: 'old-key' })
      mockUpdateApiBasedExtension.mockResolvedValue({ ...data, api_key: 'new-longer-key' })
      renderModal({ mode: 'edit', apiBasedExtension: data })

      // Act
      fireEvent.change(screen.getByDisplayValue('old-key'), { target: { value: 'new-longer-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

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
      // Arrange
      renderModal()

      // Act
      fireEvent.change(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'),
        { target: { value: 'Ext' } },
      )
      fireEvent.change(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'),
        { target: { value: 'url' } },
      )
      fireEvent.change(
        screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'),
        { target: { value: '123' } },
      )
      fireEvent.click(screen.getByText('common.operation.save'))

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
    it('should request closing when clicking cancel button', () => {
      // Arrange
      renderModal()

      // Act
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      expectCloseRequested()
    })

    it('should request closing when clicking close button', async () => {
      // Arrange
      renderModal()

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      // Assert
      await waitFor(() => {
        expectCloseRequested()
      })
    })

    it('should request closing when pressing Escape', async () => {
      // Arrange
      renderModal()

      // Act
      fireEvent.keyDown(document, { key: 'Escape' })

      // Assert
      await waitFor(() => {
        expectCloseRequested()
      })
    })

    it('should keep open when clicking outside the dialog', () => {
      // Arrange
      renderModal()

      // Act
      const backdrop = document.querySelector('.bg-background-overlay')
      expect(backdrop).toBeInTheDocument()
      fireEvent.pointerDown(backdrop!)
      fireEvent.pointerUp(backdrop!)
      fireEvent.click(backdrop!)

      // Assert
      expect(mockOnOpenChange).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing translations for placeholders gracefully', () => {
      // Arrange
      const useTranslationSpy = vi.spyOn(reactI18next, 'useTranslation')
      const originalValue = useTranslationSpy.getMockImplementation()?.() || {
        t: (key: string) => key,
        i18n: { language: 'en', changeLanguage: vi.fn() },
      }
      const missingKeys = [
        'apiBasedExtension.modal.name.placeholder',
        'apiBasedExtension.modal.apiEndpoint.placeholder',
        'apiBasedExtension.modal.apiKey.placeholder',
      ]

      useTranslationSpy.mockReturnValue({
        ...originalValue,
        t: withSelectorKey((key: string) => {
          if (missingKeys.includes(key)) return ''
          return `common.${key}`
        }, 'common') as unknown as TFunction,
      } as unknown as ReturnType<typeof reactI18next.useTranslation>)

      // Act
      const { container } = renderModal()

      // Assert
      const inputs = container.querySelectorAll('input')
      inputs.forEach((input) => {
        expect(input.placeholder).toBe('')
      })

      useTranslationSpy.mockRestore()
    })
  })
})
