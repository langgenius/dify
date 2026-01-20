import type { CreateExternalAPIReq } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import mocked service
import { createExternalAPI } from '@/service/datasets'

import AddExternalAPIModal from './index'

// Mock API service
vi.mock('@/service/datasets', () => ({
  createExternalAPI: vi.fn(),
}))

// Mock toast context
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

describe('AddExternalAPIModal', () => {
  const defaultProps = {
    onSave: vi.fn(),
    onCancel: vi.fn(),
    isEditMode: false,
  }

  const initialData: CreateExternalAPIReq = {
    name: 'Test API',
    settings: {
      endpoint: 'https://api.example.com',
      api_key: 'test-key-12345',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<AddExternalAPIModal {...defaultProps} />)
      expect(screen.getByText('dataset.createExternalAPI')).toBeInTheDocument()
    })

    it('should render create title when not in edit mode', () => {
      render(<AddExternalAPIModal {...defaultProps} isEditMode={false} />)
      expect(screen.getByText('dataset.createExternalAPI')).toBeInTheDocument()
    })

    it('should render edit title when in edit mode', () => {
      render(<AddExternalAPIModal {...defaultProps} isEditMode={true} data={initialData} />)
      expect(screen.getByText('dataset.editExternalAPIFormTitle')).toBeInTheDocument()
    })

    it('should render form fields', () => {
      render(<AddExternalAPIModal {...defaultProps} />)
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/api endpoint/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
    })

    it('should render cancel and save buttons', () => {
      render(<AddExternalAPIModal {...defaultProps} />)
      expect(screen.getByText('dataset.externalAPIForm.cancel')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalAPIForm.save')).toBeInTheDocument()
    })

    it('should render encryption notice', () => {
      render(<AddExternalAPIModal {...defaultProps} />)
      expect(screen.getByText('PKCS1_OAEP')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<AddExternalAPIModal {...defaultProps} />)
      // Close button is rendered in a portal
      const closeButton = document.body.querySelector('.action-btn')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('Edit Mode with Dataset Bindings', () => {
    it('should show warning when editing with dataset bindings', () => {
      const datasetBindings = [
        { id: 'ds-1', name: 'Dataset 1' },
        { id: 'ds-2', name: 'Dataset 2' },
      ]
      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={datasetBindings}
        />,
      )
      expect(screen.getByText('dataset.editExternalAPIFormWarning.front')).toBeInTheDocument()
      // Verify the count is displayed in the warning section
      const warningElement = screen.getByText('dataset.editExternalAPIFormWarning.front').parentElement
      expect(warningElement?.textContent).toContain('2')
    })

    it('should not show warning when no dataset bindings', () => {
      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={[]}
        />,
      )
      expect(screen.queryByText('dataset.editExternalAPIFormWarning.front')).not.toBeInTheDocument()
    })
  })

  describe('Form Interactions', () => {
    it('should update form values when input changes', () => {
      render(<AddExternalAPIModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/name/i)
      fireEvent.change(nameInput, { target: { value: 'New API Name' } })
      expect(nameInput).toHaveValue('New API Name')
    })

    it('should initialize form with data in edit mode', () => {
      render(<AddExternalAPIModal {...defaultProps} isEditMode={true} data={initialData} />)

      expect(screen.getByLabelText(/name/i)).toHaveValue('Test API')
      expect(screen.getByLabelText(/api endpoint/i)).toHaveValue('https://api.example.com')
      expect(screen.getByLabelText(/api key/i)).toHaveValue('test-key-12345')
    })

    it('should disable save button when form has empty inputs', () => {
      render(<AddExternalAPIModal {...defaultProps} />)

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')
      expect(saveButton).toBeDisabled()
    })

    it('should enable save button when all fields are filled', () => {
      render(<AddExternalAPIModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/name/i)
      const endpointInput = screen.getByLabelText(/api endpoint/i)
      const apiKeyInput = screen.getByLabelText(/api key/i)

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(endpointInput, { target: { value: 'https://test.com' } })
      fireEvent.change(apiKeyInput, { target: { value: 'key12345' } })

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')
      expect(saveButton).not.toBeDisabled()
    })
  })

  describe('Create Mode - Save', () => {
    it('should create API and call onSave on success', async () => {
      const mockResponse = {
        id: 'new-api-123',
        tenant_id: 'tenant-1',
        name: 'Test',
        description: '',
        settings: { endpoint: 'https://test.com', api_key: 'key12345' },
        dataset_bindings: [],
        created_by: 'user-1',
        created_at: '2021-01-01T00:00:00Z',
      }
      vi.mocked(createExternalAPI).mockResolvedValue(mockResponse)
      const onSave = vi.fn()
      const onCancel = vi.fn()

      render(<AddExternalAPIModal {...defaultProps} onSave={onSave} onCancel={onCancel} />)

      const nameInput = screen.getByLabelText(/name/i)
      const endpointInput = screen.getByLabelText(/api endpoint/i)
      const apiKeyInput = screen.getByLabelText(/api key/i)

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(endpointInput, { target: { value: 'https://test.com' } })
      fireEvent.change(apiKeyInput, { target: { value: 'key12345' } })

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(createExternalAPI).toHaveBeenCalledWith({
          body: {
            name: 'Test',
            settings: { endpoint: 'https://test.com', api_key: 'key12345' },
          },
        })
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'External API saved successfully',
        })
        expect(onSave).toHaveBeenCalledWith(mockResponse)
        expect(onCancel).toHaveBeenCalled()
      })
    })

    it('should show error notification when API key is too short', async () => {
      render(<AddExternalAPIModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/name/i)
      const endpointInput = screen.getByLabelText(/api endpoint/i)
      const apiKeyInput = screen.getByLabelText(/api key/i)

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(endpointInput, { target: { value: 'https://test.com' } })
      fireEvent.change(apiKeyInput, { target: { value: 'key' } }) // Less than 5 characters

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.apiBasedExtension.modal.apiKey.lengthError',
        })
      })
    })

    it('should handle create API error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(createExternalAPI).mockRejectedValue(new Error('Create failed'))

      render(<AddExternalAPIModal {...defaultProps} />)

      const nameInput = screen.getByLabelText(/name/i)
      const endpointInput = screen.getByLabelText(/api endpoint/i)
      const apiKeyInput = screen.getByLabelText(/api key/i)

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(endpointInput, { target: { value: 'https://test.com' } })
      fireEvent.change(apiKeyInput, { target: { value: 'key12345' } })

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Failed to save/update External API',
        })
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Edit Mode - Save', () => {
    it('should call onEdit directly when editing without dataset bindings', async () => {
      const onEdit = vi.fn().mockResolvedValue(undefined)
      const onCancel = vi.fn()

      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={[]}
          onEdit={onEdit}
          onCancel={onCancel}
        />,
      )

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        // When no datasetBindings, onEdit is called directly with original form data
        expect(onEdit).toHaveBeenCalledWith({
          name: 'Test API',
          settings: {
            endpoint: 'https://api.example.com',
            api_key: 'test-key-12345',
          },
        })
      })
    })

    it('should show confirm dialog when editing with dataset bindings', async () => {
      const datasetBindings = [{ id: 'ds-1', name: 'Dataset 1' }]
      const onEdit = vi.fn().mockResolvedValue(undefined)

      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={datasetBindings}
          onEdit={onEdit}
        />,
      )

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })
    })

    it('should proceed with save after confirming in edit mode with bindings', async () => {
      vi.mocked(createExternalAPI).mockResolvedValue({
        id: 'api-123',
        tenant_id: 'tenant-1',
        name: 'Test API',
        description: '',
        settings: { endpoint: 'https://api.example.com', api_key: 'test-key-12345' },
        dataset_bindings: [],
        created_by: 'user-1',
        created_at: '2021-01-01T00:00:00Z',
      })
      const datasetBindings = [{ id: 'ds-1', name: 'Dataset 1' }]
      const onCancel = vi.fn()

      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={datasetBindings}
          onCancel={onCancel}
        />,
      )

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /confirm/i })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        )
      })
    })

    it('should close confirm dialog when cancel is clicked', async () => {
      const datasetBindings = [{ id: 'ds-1', name: 'Dataset 1' }]

      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={datasetBindings}
        />,
      )

      const saveButton = screen.getByText('dataset.externalAPIForm.save').closest('button')!
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
      })

      // There are multiple cancel buttons, find the one in the confirm dialog
      const cancelButtons = screen.getAllByRole('button', { name: /cancel/i })
      const confirmDialogCancelButton = cancelButtons[cancelButtons.length - 1]
      fireEvent.click(confirmDialogCancelButton)

      await waitFor(() => {
        // Confirm button should be gone after canceling
        expect(screen.queryAllByRole('button', { name: /confirm/i })).toHaveLength(0)
      })
    })
  })

  describe('Cancel', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn()
      render(<AddExternalAPIModal {...defaultProps} onCancel={onCancel} />)

      const cancelButton = screen.getByText('dataset.externalAPIForm.cancel').closest('button')!
      fireEvent.click(cancelButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when close button is clicked', () => {
      const onCancel = vi.fn()
      render(<AddExternalAPIModal {...defaultProps} onCancel={onCancel} />)

      // Close button is rendered in a portal
      const closeButton = document.body.querySelector('.action-btn')!
      fireEvent.click(closeButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined data in edit mode', () => {
      render(<AddExternalAPIModal {...defaultProps} isEditMode={true} data={undefined} />)
      expect(screen.getByLabelText(/name/i)).toHaveValue('')
    })

    it('should handle null datasetBindings', () => {
      render(
        <AddExternalAPIModal
          {...defaultProps}
          isEditMode={true}
          data={initialData}
          datasetBindings={undefined}
        />,
      )
      expect(screen.queryByText('dataset.editExternalAPIFormWarning.front')).not.toBeInTheDocument()
    })

    it('should render documentation link in encryption notice', () => {
      render(<AddExternalAPIModal {...defaultProps} />)
      const link = screen.getByRole('link', { name: 'PKCS1_OAEP' })
      expect(link).toHaveAttribute('href', 'https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html')
      expect(link).toHaveAttribute('target', '_blank')
    })
  })
})
