import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  const mockOnCancel = vi.fn()
  const mockOnSave = vi.fn()
  const mockNotify = vi.fn()
  const mockDocLink = vi.fn((path?: string) => `https://docs.dify.ai${path || ''}`)

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock useDocLink to return the mock function, cast to match the hook's return type
    vi.mocked(useDocLink).mockReturnValue(mockDocLink as unknown as ReturnType<typeof useDocLink>)
    // Mock useToastContext providing both notify and close methods
    vi.mocked(useToastContext).mockReturnValue({ notify: mockNotify, close: vi.fn() })
  })

  it('renders for adding new extension', () => {
    render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

    expect(screen.getByText('common.apiBasedExtension.modal.title')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder')).toBeInTheDocument()
  })

  it('renders for editing existing extension', () => {
    const data = { id: '1', name: 'Existing', api_endpoint: 'url', api_key: 'key' }
    render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)

    expect(screen.getByText('common.apiBasedExtension.modal.editTitle')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument()
    expect(screen.getByDisplayValue('url')).toBeInTheDocument()
    expect(screen.getByDisplayValue('key')).toBeInTheDocument()
  })

  it('calls addApiBasedExtension on save for new extension', async () => {
    vi.mocked(addApiBasedExtension).mockResolvedValue({ id: 'new-id' })
    render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'New Ext' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'https://api.test' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: 'secret-key' } })

    fireEvent.click(screen.getByText('common.operation.save'))

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
    render(<ApiBasedExtensionModal data={data} onCancel={mockOnCancel} onSave={mockOnSave} />)

    fireEvent.change(screen.getByDisplayValue('Existing'), { target: { value: 'Updated' } })
    fireEvent.click(screen.getByText('common.operation.save'))

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

  it('shows error if api key is too short', async () => {
    render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)

    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.name.placeholder'), { target: { value: 'Ext' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiEndpoint.placeholder'), { target: { value: 'url' } })
    fireEvent.change(screen.getByPlaceholderText('common.apiBasedExtension.modal.apiKey.placeholder'), { target: { value: '123' } })

    fireEvent.click(screen.getByText('common.operation.save'))

    expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'common.apiBasedExtension.modal.apiKey.lengthError' })
    expect(addApiBasedExtension).not.toHaveBeenCalled()
  })

  it('calls onCancel when clicking cancel button', () => {
    render(<ApiBasedExtensionModal data={{}} onCancel={mockOnCancel} onSave={mockOnSave} />)
    fireEvent.click(screen.getByText('common.operation.cancel'))
    expect(mockOnCancel).toHaveBeenCalled()
  })
})
