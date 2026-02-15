import type { TFunction } from 'i18next'
import type { IToastProps } from '@/app/components/base/toast'
import type { ApiBasedExtension } from '@/models/common'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as reactI18next from 'react-i18next'
import { vi } from 'vitest'
import { useToastContext } from '@/app/components/base/toast'
import { useDocLink } from '@/context/i18n'
import { addApiBasedExtension, updateApiBasedExtension } from '@/service/common'
import ApiBasedExtensionModal from './modal'

vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  addApiBasedExtension: vi.fn(),
  updateApiBasedExtension: vi.fn(),
}))

describe('ApiBasedExtensionModal', () => {
  const mockOnCancel = vi.fn<() => void>()
  const mockOnSave = vi.fn<(data: ApiBasedExtension) => void>()
  const mockNotify = vi.fn<(params: { type: string, message: string }) => void>()
  const mockDocLink = vi.fn<(path?: string) => string>((path?: string) => `https://docs.dify.ai${path || ''}`)

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock useDocLink with proper typing
    vi.mocked(useDocLink).mockReturnValue(mockDocLink)
    // Mock useToastContext providing both notify and close methods
    vi.mocked(useToastContext).mockReturnValue({ notify: mockNotify as unknown as (props: IToastProps) => void, close: vi.fn<() => void>() })
  })

  it('renders for adding new extension', async () => {
    await act(async () => {
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    expect(screen.getByText('common.apiBasedExtension.modal.title')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder')).toBeInTheDocument()
  })

  it('renders for editing existing extension', async () => {
    const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'key' }
    await act(async () => {
      render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    expect(screen.getByText('common.apiBasedExtension.modal.editTitle')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument()
    expect(screen.getByDisplayValue('url')).toBeInTheDocument()
    expect(screen.getByDisplayValue('key')).toBeInTheDocument()
  })

  it('calls addApiBasedExtension on save for new extension', async () => {
    vi.mocked(addApiBasedExtension).mockResolvedValue({ id: 'new-id' })
    await act(async () => {
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.save'))
    })

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

  it('calls updateApiBasedExtension on save for existing extension', async () => {
    const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'long-secret-key' }
    vi.mocked(updateApiBasedExtension).mockResolvedValue({ ...data, name: 'Updated' })
    await act(async () => {
      render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    fireEvent.change(screen.getByDisplayValue('Existing'), { target: { value: 'Updated' } })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.save'))
    })

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

  it('calls updateApiBasedExtension with new api_key when key is changed', async () => {
    const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'old-key' }
    vi.mocked(updateApiBasedExtension).mockResolvedValue({ ...data, api_key: 'new-longer-key' })
    await act(async () => {
      render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    fireEvent.change(screen.getByDisplayValue('old-key'), { target: { value: 'new-longer-key' } })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.save'))
    })

    await waitFor(() => {
      expect(updateApiBasedExtension).toHaveBeenCalledWith({
        url: '/api-based-extension/1',
        body: expect.objectContaining({
          api_key: 'new-longer-key',
        }),
      })
    })
  })

  it('shows error if api key is too short', async () => {
    await act(async () => {
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'Ext' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'url' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: '123' } })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.save'))
    })

    expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'common.apiBasedExtension.modal.apiKey.lengthError' })
    expect(addApiBasedExtension).not.toHaveBeenCalled()
  })

  it('works when onSave is not provided', async () => {
    vi.mocked(addApiBasedExtension).mockResolvedValue({ id: 'new-id' })
    await act(async () => {
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} />)
    })

    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.save'))
    })

    await waitFor(() => {
      expect(addApiBasedExtension).toHaveBeenCalled()
    })
  })

  it('calls onCancel when clicking cancel button', async () => {
    await act(async () => {
      render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByText('common.operation.cancel'))
    })
    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('covers placeholder fallback branches when translations are missing', async () => {
    const useTranslationSpy = vi.spyOn(reactI18next, 'useTranslation')
    const currentImpl = useTranslationSpy.getMockImplementation()
    const originalValue = currentImpl
      ? currentImpl()
      : {
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

    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} />)
      container = rendered.container
    })

    const inputs = container!.querySelectorAll('input')
    inputs.forEach((input) => {
      expect(input.placeholder).toBe('')
    })

    useTranslationSpy.mockRestore()
  })
})
