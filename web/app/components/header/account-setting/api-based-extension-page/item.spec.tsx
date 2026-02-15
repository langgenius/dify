import type { TFunction } from 'i18next'
import type { SetStateAction } from 'react'
import type { ModalState } from '@/context/modal-context'
import type { ApiBasedExtension } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as reactI18next from 'react-i18next'
import { vi } from 'vitest'
import { useModalContext } from '@/context/modal-context'
import { deleteApiBasedExtension } from '@/service/common'
import Item from './item'

// Mock the modal context to isolate component behavior
vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

// Mock the API service to avoid real network calls
vi.mock('@/service/common', () => ({
  deleteApiBasedExtension: vi.fn(),
}))

describe('Item Component', () => {
  // Test data representing a valid API-based extension
  const mockData: ApiBasedExtension = {
    id: '1',
    name: 'Test Extension',
    api_endpoint: 'https://api.example.com',
    api_key: 'test-api-key',
  }
  const mockOnUpdate = vi.fn<() => void>()
  const mockSetShowApiBasedExtensionModal = vi.fn<(value: SetStateAction<ModalState<ApiBasedExtension> | null>) => void>()

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock the modal context with proper typing
    vi.mocked(useModalContext).mockReturnValue({
      setShowAccountSettingModal: vi.fn(),
      setShowApiBasedExtensionModal: mockSetShowApiBasedExtensionModal,
      setShowModerationSettingModal: vi.fn(),
      setShowExternalDataToolModal: vi.fn(),
      setShowPricingModal: vi.fn(),
      setShowAnnotationFullModal: vi.fn(),
      setShowModelModal: vi.fn(),
      setShowExternalKnowledgeAPIModal: vi.fn(),
      setShowModelLoadBalancingModal: vi.fn(),
      setShowOpeningModal: vi.fn(),
      setShowUpdatePluginModal: vi.fn(),
      setShowEducationExpireNoticeModal: vi.fn(),
      setShowTriggerEventsLimitModal: vi.fn(),
    })
  })

  it('renders extension data correctly', () => {
    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    // Verify that extension name and endpoint are displayed
    expect(screen.getByText('Test Extension')).toBeInTheDocument()
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
  })

  it('opens edit modal with correct payload when clicking edit button', () => {
    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.operation.edit'))

    // Verify modal is opened with the extension data
    expect(mockSetShowApiBasedExtensionModal).toHaveBeenCalledWith(expect.objectContaining({
      payload: mockData,
    }))

    // Separately verify that onSaveCallback is a function
    const lastCall = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
    if (typeof lastCall === 'object' && lastCall !== null && 'onSaveCallback' in lastCall)
      expect(lastCall.onSaveCallback).toBeInstanceOf(Function)
  })

  it('executes onUpdate callback when edit modal save callback is invoked', () => {
    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.operation.edit'))

    // Extract and verify the onSaveCallback from the modal call
    const modalCallArg = mockSetShowApiBasedExtensionModal.mock.calls[0][0]
    if (typeof modalCallArg === 'object' && modalCallArg !== null && 'onSaveCallback' in modalCallArg) {
      const onSaveCallback = modalCallArg.onSaveCallback
      expect(onSaveCallback).toBeDefined()
      if (onSaveCallback) {
        onSaveCallback()
        expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      }
    }
  })

  it('shows delete confirmation dialog when clicking delete button', () => {
    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.operation.delete'))

    // Verify confirmation dialog appears with extension name
    // Using regex to match the specific order "delete ... name" which exists in the modal title
    // but NOT in the list item (where name comes before delete button)
    // Also handles the curly quotes by matching any character
    expect(screen.getByText(/common\.operation\.delete.*Test Extension.*\?/i)).toBeInTheDocument()
  })

  it('calls delete API and triggers onUpdate when confirming deletion', async () => {
    // Mock successful API response
    vi.mocked(deleteApiBasedExtension).mockResolvedValue({ result: 'success' })

    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    // Open delete confirmation
    fireEvent.click(screen.getByText('common.operation.delete'))

    // Click the confirm button (last delete button in the list)
    const deleteButtons = screen.getAllByText('common.operation.delete')
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    // Verify API was called with correct endpoint and onUpdate was triggered
    await waitFor(() => {
      expect(deleteApiBasedExtension).toHaveBeenCalledWith('/api-based-extension/1')
      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
    })
  })

  it('hides delete confirmation dialog after successful deletion', async () => {
    vi.mocked(deleteApiBasedExtension).mockResolvedValue({ result: 'success' })

    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.operation.delete'))

    const deleteButtons = screen.getAllByText('common.operation.delete')
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    // Verify confirmation dialog is removed after deletion
    await waitFor(() => {
      expect(screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i)).not.toBeInTheDocument()
    })
  })

  it('closes delete confirmation when clicking cancel button', () => {
    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    // Open and then cancel the delete confirmation
    fireEvent.click(screen.getByText('common.operation.delete'))
    fireEvent.click(screen.getByText('common.operation.cancel'))

    // Verify confirmation dialog is closed
    expect(screen.queryByText(/common\.operation\.delete.*Test Extension.*\?/i)).not.toBeInTheDocument()
  })

  it('does not call delete API when canceling deletion', () => {
    render(<Item data={mockData} onUpdate={mockOnUpdate} />)

    fireEvent.click(screen.getByText('common.operation.delete'))
    fireEvent.click(screen.getByText('common.operation.cancel'))

    // Verify delete API was never called
    expect(deleteApiBasedExtension).not.toHaveBeenCalled()
    expect(mockOnUpdate).not.toHaveBeenCalled()
  })

  it('renders with minimal extension data (only required fields)', () => {
    // Test with minimal data to ensure component handles optional fields
    const minimalData: ApiBasedExtension = {
      id: '2',
    }

    render(<Item data={minimalData} onUpdate={mockOnUpdate} />)

    // Component should render without crashing even with minimal data
    expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
    expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
  })

  it('test for translation is missing for confirm text', () => {
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
        // Return empty string only for the delete operation key
        if (key === 'operation.delete')
          return ''
        return key
      }) as unknown as TFunction,
    } as unknown as ReturnType<typeof reactI18next.useTranslation>)

    render(<Item data={mockData} onUpdate={mockOnUpdate} />)
    const allButtons = screen.getAllByRole('button')
    // The first button is Edit, second is Delete.
    // Even when translation is missing, we can find it by excluding the edit button.
    const editBtn = screen.getByText('operation.edit')
    const deleteBtn = allButtons.find(btn => btn !== editBtn)
    if (deleteBtn)
      fireEvent.click(deleteBtn)

    // The confirmation modal should still show up (title will be empty prefix)
    // In the codebase: title={`${t('operation.delete', { ns: 'common' })} “${data.name}”?`}
    // If t returns '', title will be " “Test Extension”?"
    expect(screen.getByText(/.*Test Extension.*\?/i)).toBeInTheDocument()

    useTranslationSpy.mockRestore()
  })
})
