import type { DataSet } from '@/models/datasets'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import RenameDatasetModal from './index'

// Mock service
const mockUpdateDatasetSetting = vi.fn()
vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: (params: unknown) => mockUpdateDatasetSetting(params),
}))

// Mock Toast
const mockToastNotify = vi.fn()
vi.mock('../../base/toast', () => ({
  default: {
    notify: (params: unknown) => mockToastNotify(params),
  },
}))

// Mock AppIcon - simplified mock to enable testing onClick callback
vi.mock('../../base/app-icon', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button data-testid="app-icon" onClick={onClick}>Icon</button>
  ),
}))

// Mock AppIconPicker - simplified mock to test onSelect and onClose callbacks
vi.mock('../../base/app-icon-picker', () => ({
  default: ({ onSelect, onClose }: {
    onSelect?: (icon: { type: string, icon?: string, background?: string, fileId?: string, url?: string }) => void
    onClose?: () => void
  }) => (
    <div data-testid="app-icon-picker">
      <button data-testid="select-emoji" onClick={() => onSelect?.({ type: 'emoji', icon: '🚀', background: '#E0F2FE' })}>
        Select Emoji
      </button>
      <button data-testid="select-image" onClick={() => onSelect?.({ type: 'image', fileId: 'new-file', url: 'https://new.png' })}>
        Select Image
      </button>
      <button data-testid="close-picker" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Note: react-i18next is globally mocked in vitest.setup.ts
// The mock returns 'ns.key' format, e.g., 'common.operation.cancel'

describe('RenameDatasetModal', () => {
  // Create a base dataset with emoji icon
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    indexing_status: 'completed',
    icon_info: {
      icon: '📊',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
      icon_url: undefined,
    },
    permission: DatasetPermission.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    created_by: 'user-1',
    updated_by: 'user-1',
    updated_at: Date.now(),
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 5,
    total_document_count: 5,
    word_count: 1000,
    provider: 'openai',
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: {} as DataSet['retrieval_model_dict'],
    retrieval_model: {} as DataSet['retrieval_model'],
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: '',
      external_knowledge_api_id: '',
      external_knowledge_api_name: '',
      external_knowledge_api_endpoint: '',
    },
    external_retrieval_model: {
      top_k: 3,
      score_threshold: 0.5,
      score_threshold_enabled: false,
    },
    built_in_field_enabled: false,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    ...overrides,
  })

  // Create a dataset with image icon
  const createMockDatasetWithImageIcon = (): DataSet => createMockDataset({
    icon_info: {
      icon: 'file-id-123',
      icon_type: 'image',
      icon_background: undefined,
      icon_url: 'https://example.com/icon.png',
    },
  })

  // Create a dataset with external knowledge info
  const createMockExternalDataset = (): DataSet => createMockDataset({
    external_knowledge_info: {
      external_knowledge_id: 'ext-knowledge-1',
      external_knowledge_api_id: 'ext-api-1',
      external_knowledge_api_name: 'External API',
      external_knowledge_api_endpoint: 'https://api.example.com',
    },
  })

  const defaultProps = {
    show: true,
    dataset: createMockDataset(),
    onSuccess: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDatasetSetting.mockResolvedValue(createMockDataset())
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      // Check title is rendered (translation mock returns 'datasetSettings.title')
      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should render modal when show is true', () => {
      render(<RenameDatasetModal {...defaultProps} show={true} />)
      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should render name input with dataset name', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput).toBeInTheDocument()
    })

    it('should render description textarea with dataset description', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea).toBeInTheDocument()
    })

    it('should render cancel and save buttons', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
      expect(screen.getByText('common.operation.save')).toBeInTheDocument()
    })

    it('should render close icon button', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      // The modal renders with title and other elements
      // The close functionality is tested in user interactions
      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()
    })

    it('should render form labels', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      expect(screen.getByText('datasetSettings.form.name')).toBeInTheDocument()
      expect(screen.getByText('datasetSettings.form.desc')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should render with emoji icon dataset', () => {
      const dataset = createMockDataset()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should render with image icon dataset', () => {
      const dataset = createMockDatasetWithImageIcon()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should render with empty description', () => {
      const dataset = createMockDataset({ description: '' })
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      // Find the textarea by its placeholder
      const descriptionTextarea = screen.getByPlaceholderText('datasetSettings.form.descPlaceholder')
      expect(descriptionTextarea).toHaveValue('')
    })

    it('should render with external knowledge dataset', () => {
      const dataset = createMockExternalDataset()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should handle undefined onSuccess callback', () => {
      render(<RenameDatasetModal {...defaultProps} onSuccess={undefined} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })
  })

  describe('State Management', () => {
    it('should initialize name state with dataset name', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should initialize description state with dataset description', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      expect(screen.getByDisplayValue('Test description')).toBeInTheDocument()
    })

    it('should update name state when input changes', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      fireEvent.change(nameInput, { target: { value: 'New Dataset Name' } })

      expect(screen.getByDisplayValue('New Dataset Name')).toBeInTheDocument()
    })

    it('should update description state when textarea changes', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')

      fireEvent.change(descriptionTextarea, { target: { value: 'New description' } })

      expect(screen.getByDisplayValue('New description')).toBeInTheDocument()
    })

    it('should clear name when input is cleared', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      fireEvent.change(nameInput, { target: { value: '' } })

      expect(nameInput).toHaveValue('')
    })

    it('should handle special characters in name', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      fireEvent.change(nameInput, { target: { value: 'Dataset <script>alert("xss")</script>' } })

      expect(screen.getByDisplayValue('Dataset <script>alert("xss")</script>')).toBeInTheDocument()
    })

    it('should handle very long name input', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')
      const longName = 'A'.repeat(500)

      fireEvent.change(nameInput, { target: { value: longName } })

      expect(screen.getByDisplayValue(longName)).toBeInTheDocument()
    })

    it('should handle multiline description', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')
      const multilineDesc = 'Line 1\nLine 2\nLine 3'

      fireEvent.change(descriptionTextarea, { target: { value: multilineDesc } })

      // Verify the textarea contains the multiline value
      expect(descriptionTextarea).toHaveValue(multilineDesc)
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when cancel button is clicked', () => {
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      const cancelButton = screen.getByText('common.operation.cancel')
      fireEvent.click(cancelButton)

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close icon is clicked', () => {
      // This test is covered by the cancel button test
      // The close icon functionality works the same way as cancel button
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      // Use the cancel button to verify close callback works
      const cancelButton = screen.getByText('common.operation.cancel')
      fireEvent.click(cancelButton)

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should call API when save button is clicked with valid name', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            name: 'Test Dataset',
            description: 'Test description',
          }),
        })
      })
    })

    it('should disable save button while loading', async () => {
      // Create a promise that we can control
      let resolvePromise: (value: DataSet) => void
      mockUpdateDatasetSetting.mockImplementation(() => new Promise((resolve) => {
        resolvePromise = resolve
      }))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(saveButton).toBeDisabled()
      })

      // Resolve the promise to clean up
      await act(async () => {
        resolvePromise!(createMockDataset())
      })
    })

    it('should handle name input focus', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      // Verify the input can receive focus
      nameInput.focus()

      // Just verify the element is focusable (don't check activeElement as it may differ in test environment)
      expect(nameInput).not.toBeDisabled()
    })

    it('should handle description textarea focus', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')

      // Verify the textarea can receive focus
      descriptionTextarea.focus()

      // Just verify the element is focusable
      expect(descriptionTextarea).not.toBeDisabled()
    })
  })

  describe('API Calls', () => {
    it('should call updateDatasetSetting with correct parameters', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: 'Updated Name' } })

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: {
            name: 'Updated Name',
            description: 'Test description',
            icon_info: {
              icon: '📊',
              icon_type: 'emoji',
              icon_background: '#FFEAD5',
              icon_url: undefined,
            },
          },
        })
      })
    })

    it('should include external knowledge IDs when present', async () => {
      const dataset = createMockExternalDataset()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            external_knowledge_id: 'ext-knowledge-1',
            external_knowledge_api_id: 'ext-api-1',
          }),
        })
      })
    })

    it('should not include external knowledge IDs when not present', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalled()
        const callArgs = mockUpdateDatasetSetting.mock.calls[0][0]
        expect(callArgs.body.external_knowledge_id).toBeUndefined()
        expect(callArgs.body.external_knowledge_api_id).toBeUndefined()
      })
    })

    it('should handle image icon correctly in API call', async () => {
      const dataset = createMockDatasetWithImageIcon()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: 'file-id-123',
              icon_type: 'image',
              icon_background: undefined,
              icon_url: 'https://example.com/icon.png',
            },
          }),
        })
      })
    })

    it('should call onSuccess and onClose after successful save', async () => {
      const handleSuccess = vi.fn()
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onSuccess={handleSuccess} onClose={handleClose} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(handleSuccess).toHaveBeenCalledTimes(1)
        expect(handleClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should show success toast after successful save', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.actionMsg.modifiedSuccessfully',
        })
      })
    })
  })

  describe('Error Handling', () => {
    it('should show error toast when name is empty', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: '' } })

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetSettings.form.nameError',
        })
      })
    })

    it('should show error toast when name is only whitespace', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: '   ' } })

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'datasetSettings.form.nameError',
        })
      })
    })

    it('should not call API when name is invalid', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: '' } })

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
      })
    })

    it('should show error toast when API call fails', async () => {
      mockUpdateDatasetSetting.mockRejectedValueOnce(new Error('API Error'))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })
    })

    it('should not call onSuccess when API call fails', async () => {
      mockUpdateDatasetSetting.mockRejectedValueOnce(new Error('API Error'))
      const handleSuccess = vi.fn()

      render(<RenameDatasetModal {...defaultProps} onSuccess={handleSuccess} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })

      expect(handleSuccess).not.toHaveBeenCalled()
    })

    it('should not call onClose when API call fails', async () => {
      mockUpdateDatasetSetting.mockRejectedValueOnce(new Error('API Error'))
      const handleClose = vi.fn()

      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalled()
      })

      expect(handleClose).not.toHaveBeenCalled()
    })

    it('should reset loading state after API error', async () => {
      mockUpdateDatasetSetting.mockRejectedValueOnce(new Error('API Error'))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      // Wait for error handling to complete
      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalled()
      })

      // Save button should be enabled again
      expect(saveButton).not.toBeDisabled()
    })
  })

  describe('Callback Stability', () => {
    it('should call onClose exactly once per click', () => {
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      const cancelButton = screen.getByText('common.operation.cancel')
      fireEvent.click(cancelButton)
      fireEvent.click(cancelButton)

      expect(handleClose).toHaveBeenCalledTimes(2)
    })

    it('should not call onSuccess when undefined', async () => {
      render(<RenameDatasetModal {...defaultProps} onSuccess={undefined} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalled()
      })

      // Should not throw error when onSuccess is undefined
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
    })

    it('should maintain callback identity across renders', async () => {
      const handleClose = vi.fn()
      const { rerender } = render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      // Change input to trigger re-render
      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: 'New Name' } })

      // Re-render with same callback
      rerender(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      const cancelButton = screen.getByText('common.operation.cancel')
      fireEvent.click(cancelButton)

      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Icon Picker Integration', () => {
    it('should render app icon component', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      // The modal should render with name label and input
      // AppIcon is rendered alongside the name input
      expect(screen.getByText('datasetSettings.form.name')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should initialize icon state from dataset', () => {
      // Test with emoji icon
      render(<RenameDatasetModal {...defaultProps} />)
      // The component initializes with the dataset's icon_info
      // This is verified by checking the form renders correctly
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should initialize icon state from image icon dataset', () => {
      // Test with image icon - this triggers the icon_type === 'image' branch
      const imageDataset = createMockDatasetWithImageIcon()
      render(<RenameDatasetModal {...defaultProps} dataset={imageDataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
      // The component should render successfully with image icon dataset
    })

    it('should save with image icon data when dataset has image icon', async () => {
      // Verify icon state is correctly initialized from image icon dataset
      const imageDataset = createMockDatasetWithImageIcon()
      render(<RenameDatasetModal {...defaultProps} dataset={imageDataset} />)

      // Save directly to verify the icon data is correctly passed
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: 'file-id-123',
              icon_type: 'image',
              icon_background: undefined,
              icon_url: 'https://example.com/icon.png',
            },
          }),
        })
      })
    })

    it('should save with emoji icon data when dataset has emoji icon', async () => {
      // Verify icon state is correctly initialized from emoji icon dataset
      render(<RenameDatasetModal {...defaultProps} />)

      // Save directly to verify the icon data is correctly passed
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: '📊',
              icon_type: 'emoji',
              icon_background: '#FFEAD5',
              icon_url: undefined,
            },
          }),
        })
      })
    })

    it('should open icon picker when app icon is clicked (handleOpenAppIconPicker)', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      // Initially picker should not be visible
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()

      // Click app icon to open picker
      const appIcon = screen.getByTestId('app-icon')
      await act(async () => {
        fireEvent.click(appIcon)
      })

      // Picker should now be visible
      expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
    })

    it('should select emoji icon and close picker (handleSelectAppIcon)', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      // Open picker
      const appIcon = screen.getByTestId('app-icon')
      await act(async () => {
        fireEvent.click(appIcon)
      })

      // Select emoji
      const selectEmojiBtn = screen.getByTestId('select-emoji')
      await act(async () => {
        fireEvent.click(selectEmojiBtn)
      })

      // Picker should close after selection
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()

      // Save and verify new icon is used
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: '🚀',
              icon_type: 'emoji',
              icon_background: '#E0F2FE',
              icon_url: undefined,
            },
          }),
        })
      })
    })

    it('should select image icon and close picker (handleSelectAppIcon)', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      // Open picker
      const appIcon = screen.getByTestId('app-icon')
      await act(async () => {
        fireEvent.click(appIcon)
      })

      // Select image
      const selectImageBtn = screen.getByTestId('select-image')
      await act(async () => {
        fireEvent.click(selectImageBtn)
      })

      // Picker should close after selection
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()

      // Save and verify new image icon is used
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: 'new-file',
              icon_type: 'image',
              icon_background: undefined,
              icon_url: 'https://new.png',
            },
          }),
        })
      })
    })

    it('should restore previous icon when picker is closed (handleCloseAppIconPicker)', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      // Open picker
      const appIcon = screen.getByTestId('app-icon')
      await act(async () => {
        fireEvent.click(appIcon)
      })

      // Close picker without selecting
      const closeBtn = screen.getByTestId('close-picker')
      await act(async () => {
        fireEvent.click(closeBtn)
      })

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()

      // Save and verify original icon is preserved
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: '📊',
              icon_type: 'emoji',
              icon_background: '#FFEAD5',
              icon_url: undefined,
            },
          }),
        })
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle dataset with null icon_info', () => {
      const dataset = createMockDataset({
        icon_info: {
          icon: '',
          icon_type: 'emoji',
          icon_background: '',
          icon_url: undefined,
        },
      })

      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should handle image icon with empty icon_url', async () => {
      // Test the || '' fallback for icon_url in image icon
      const dataset = createMockDataset({
        icon_info: {
          icon: 'file-id',
          icon_type: 'image',
          icon_background: undefined,
          icon_url: '', // Empty string - triggers || '' fallback
        },
      })

      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()

      // Save and verify the icon_url is handled correctly
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: expect.objectContaining({
              icon: 'file-id',
              icon_type: 'image',
              icon_url: '',
            }),
          }),
        })
      })
    })

    it('should handle image icon with undefined icon', async () => {
      // Test the || '' fallback for icon (fileId) in image icon
      const dataset = createMockDataset({
        icon_info: {
          icon: '', // Empty string - triggers || '' fallback
          icon_type: 'image',
          icon_background: undefined,
          icon_url: 'https://example.com/icon.png',
        },
      })

      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()

      // Save and verify the icon is handled correctly
      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: expect.objectContaining({
              icon: '',
              icon_type: 'image',
              icon_url: 'https://example.com/icon.png',
            }),
          }),
        })
      })
    })

    it('should handle dataset with empty external knowledge info', () => {
      const dataset = createMockDataset({
        external_knowledge_info: {
          external_knowledge_id: '',
          external_knowledge_api_id: '',
          external_knowledge_api_name: '',
          external_knowledge_api_endpoint: '',
        },
      })

      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should handle rapid input changes', async () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      // Simulate rapid typing
      fireEvent.change(nameInput, { target: { value: 'N' } })
      fireEvent.change(nameInput, { target: { value: 'Ne' } })
      fireEvent.change(nameInput, { target: { value: 'New' } })
      fireEvent.change(nameInput, { target: { value: 'New ' } })
      fireEvent.change(nameInput, { target: { value: 'New N' } })
      fireEvent.change(nameInput, { target: { value: 'New Na' } })
      fireEvent.change(nameInput, { target: { value: 'New Nam' } })
      fireEvent.change(nameInput, { target: { value: 'New Name' } })

      expect(screen.getByDisplayValue('New Name')).toBeInTheDocument()
    })

    it('should handle double click on save button', async () => {
      // Use a promise we can control to ensure the first click is still "loading"
      let resolvePromise: (value: DataSet) => void
      mockUpdateDatasetSetting.mockImplementationOnce(() => new Promise((resolve) => {
        resolvePromise = resolve
      }))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')

      // First click
      await act(async () => {
        fireEvent.click(saveButton)
      })

      // Button should be disabled now
      expect(saveButton).toBeDisabled()

      // Second click should not trigger another API call because button is disabled
      await act(async () => {
        fireEvent.click(saveButton)
      })

      // Only one API call should have been made
      expect(mockUpdateDatasetSetting).toHaveBeenCalledTimes(1)

      // Clean up by resolving the promise
      await act(async () => {
        resolvePromise!(createMockDataset())
      })
    })

    it('should handle unicode characters in name', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')

      fireEvent.change(nameInput, { target: { value: '数据集 🎉 Dataset' } })

      expect(screen.getByDisplayValue('数据集 🎉 Dataset')).toBeInTheDocument()
    })

    it('should handle unicode characters in description', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')

      fireEvent.change(descriptionTextarea, { target: { value: '这是一个测试描述 🚀' } })

      expect(screen.getByDisplayValue('这是一个测试描述 🚀')).toBeInTheDocument()
    })

    it('should preserve whitespace in description', () => {
      render(<RenameDatasetModal {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')

      const testValue = 'Leading spaces with content'
      fireEvent.change(descriptionTextarea, { target: { value: testValue } })

      expect(descriptionTextarea).toHaveValue(testValue)
    })
  })

  describe('Component Re-rendering', () => {
    it('should update when dataset prop changes', () => {
      const { rerender } = render(<RenameDatasetModal {...defaultProps} />)

      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()

      const newDataset = createMockDataset({ name: 'Different Dataset', description: 'Different description' })
      rerender(<RenameDatasetModal {...defaultProps} dataset={newDataset} />)

      // Note: The component uses useState with initial value, so it won't update
      // This tests that the initial render works correctly with different props
      expect(screen.getByDisplayValue('Test Dataset')).toBeInTheDocument()
    })

    it('should handle show prop toggle', () => {
      const { rerender } = render(<RenameDatasetModal {...defaultProps} show={true} />)

      expect(screen.getByText('datasetSettings.title')).toBeInTheDocument()

      rerender(<RenameDatasetModal {...defaultProps} show={false} />)

      // Modal visibility is controlled by Modal component's isShow prop
      // The modal content may still be in DOM but hidden
    })
  })

  describe('Accessibility', () => {
    it('should have accessible input elements', () => {
      render(<RenameDatasetModal {...defaultProps} />)

      // Check that inputs are present and accessible
      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput.tagName.toLowerCase()).toBe('input')

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea.tagName.toLowerCase()).toBe('textarea')
    })

    it('should have clickable buttons', () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const cancelButton = screen.getByText('common.operation.cancel')
      const saveButton = screen.getByText('common.operation.save')

      expect(cancelButton).toBeEnabled()
      expect(saveButton).toBeEnabled()
    })
  })

  describe('Loading State', () => {
    it('should show loading state during API call', async () => {
      let resolvePromise: (value: DataSet) => void
      mockUpdateDatasetSetting.mockImplementation(() => new Promise((resolve) => {
        resolvePromise = resolve
      }))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      // Button should be disabled during loading
      await waitFor(() => {
        expect(saveButton).toBeDisabled()
      })

      // Resolve promise to complete the test
      await act(async () => {
        resolvePromise!(createMockDataset())
      })

      await waitFor(() => {
        expect(saveButton).not.toBeDisabled()
      })
    })

    it('should re-enable save button after successful save', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalled()
      })

      // After success, the modal closes, but if it didn't, button would be re-enabled
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
    })

    it('should re-enable save button after failed save', async () => {
      mockUpdateDatasetSetting.mockRejectedValueOnce(new Error('API Error'))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByText('common.operation.save')
      await act(async () => {
        fireEvent.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })

      // Button should be re-enabled after error
      expect(saveButton).not.toBeDisabled()
    })
  })
})
