import type { TFunction } from 'i18next'
import type { IToastProps } from '@/app/components/base/toast'
import { fireEvent, render as RTLRender, screen, waitFor } from '@testing-library/react'
import * as reactI18next from 'react-i18next'
import { ToastContext } from '@/app/components/base/toast'
import { useDocLink } from '@/context/i18n'
import { addApiBasedExtension, updateApiBasedExtension } from '@/service/common'
import ApiBasedExtensionModal from './modal'

vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  addApiBasedExtension: vi.fn(),
  updateApiBasedExtension: vi.fn(),
}))

describe('ApiBasedExtensionModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnSave = vi.fn()
  const mockNotify = vi.fn()
  const mockDocLink = vi.fn((path?: string) => `https://docs.dify.ai${path || ''}`)

  const render = (ui: React.ReactElement) => RTLRender(
    <ToastContext.Provider value={{
      notify: mockNotify as unknown as (props: IToastProps) => void,
      close: vi.fn(),
    }}
    >
      {ui}
    </ToastContext.Provider>,
  )

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDocLink).mockReturnValue(mockDocLink)
  })

  describe('Rendering', () => {
    it('should render correctly for adding a new extension', () => {
      // Act
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.modal.title')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder')).toBeInTheDocument()
    })

    it('should render correctly for editing an existing extension', () => {
      // Arrange
      const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'key' }

      // Act
      render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.modal.editTitle')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Existing')).toBeInTheDocument()
      expect(screen.getByDisplayValue('url')).toBeInTheDocument()
      expect(screen.getByDisplayValue('key')).toBeInTheDocument()
    })
  })

  describe('Form Submissions', () => {
    it('should call addApiBasedExtension on save for new extension', async () => {
      // Arrange
      vi.mocked(addApiBasedExtension).mockResolvedValue({ id: 'new-id' })
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(addApiBasedExtension).toHaveBeenCalledWith({
          url: '/api-based-extension',
          body: {
            name: 'New Ext',
            api_endpoint: 'https://api.test',
            api_key: 'secret-key',
          },
        })
        expect(mockOnSave).toHaveBeenCalledWith({ id: 'new-id' })
      })
    })

    it('should call updateApiBasedExtension on save for existing extension', async () => {
      // Arrange
      const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'long-secret-key' }
      vi.mocked(updateApiBasedExtension).mockResolvedValue({ ...data, name: 'Updated' })
      render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Act
      fireEvent.change(screen.getByDisplayValue('Existing'), { target: { value: 'Updated' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(updateApiBasedExtension).toHaveBeenCalledWith({
          url: '/api-based-extension/1',
          body: expect.objectContaining({
            id: '1',
            name: 'Updated',
            api_endpoint: 'url',
            api_key: '[__HIDDEN__]',
          }),
        })
        expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'common.actionMsg.modifiedSuccessfully' })
        expect(mockOnSave).toHaveBeenCalled()
      })
    })

    it('should call updateApiBasedExtension with new api_key when key is changed', async () => {
      // Arrange
      const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'old-key' }
      vi.mocked(updateApiBasedExtension).mockResolvedValue({ ...data, api_key: 'new-longer-key' })
      render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Act
      fireEvent.change(screen.getByDisplayValue('old-key'), { target: { value: 'new-longer-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(updateApiBasedExtension).toHaveBeenCalledWith({
          url: '/api-based-extension/1',
          body: expect.objectContaining({
            api_key: 'new-longer-key',
          }),
        })
      })
    })
  })

  describe('Validation', () => {
    it('should show error if api key is too short', async () => {
      // Arrange
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'Ext' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'url' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: '123' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'common.apiBasedExtension.modal.apiKey.lengthError' })
      expect(addApiBasedExtension).not.toHaveBeenCalled()
    })
  })

  describe('Interactions', () => {
    it('should work when onSave is not provided', async () => {
      // Arrange
      vi.mocked(addApiBasedExtension).mockResolvedValue({ id: 'new-id' })
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} />)

      // Act
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
      fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })
      fireEvent.click(screen.getByText('common.operation.save'))

      // Assert
      await waitFor(() => {
        expect(addApiBasedExtension).toHaveBeenCalled()
      })
    })

    it('should call onCancel when clicking cancel button', () => {
      // Arrange
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

      // Act
      fireEvent.click(screen.getByText('common.operation.cancel'))

      // Assert
      expect(mockOnCancel).toHaveBeenCalled()
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

      useTranslationSpy.mockReturnValue({
        ...originalValue,
        t: vi.fn().mockImplementation((key: string) => {
          const missingKeys = [
            'apiBasedExtension.modal.name.placeholder',
            'apiBasedExtension.modal.apiEndpoint.placeholder',
            'apiBasedExtension.modal.apiKey.placeholder',
          ]
          if (missingKeys.some(k => key.includes(k)))
            return ''
          return key
        }) as unknown as TFunction,
      } as unknown as ReturnType<typeof reactI18next.useTranslation>)

      // Act
      const { container } = render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} />)

      // Assert
      const inputs = container.querySelectorAll('input')
      inputs.forEach((input) => {
        expect(input.placeholder).toBe('')
      })

      useTranslationSpy.mockRestore()
    })
  })
})
