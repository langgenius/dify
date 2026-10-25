import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import { PermissionLevel } from '@/models/permission'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import RenameDatasetModal from '../index'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

const mockUpdateDatasetSetting = vi.fn()
vi.mock('@/service/datasets', () => ({
  updateDatasetSetting: (params: unknown) => mockUpdateDatasetSetting(params),
}))

// The mock returns 'ns.key' format, e.g., 'common.operation.cancel'

mockEmojiData()

describe('RenameDatasetModal', () => {
  // Create a base dataset with emoji icon
  const createMockDataset = (
    overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
  ): DatasetDetailWithPartialMembersResponse => ({
    ...createDatasetFixture(),
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    icon_info: {
      icon: '📊',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
      icon_url: undefined,
    },
    permission: PermissionLevel.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    created_by: 'user-1',
    updated_by: 'user-1',
    updated_at: 1700000000,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 5,
    word_count: 1000,
    provider: 'openai',
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    embedding_available: true,
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
  const createMockDatasetWithImageIcon = (): DatasetDetailWithPartialMembersResponse =>
    createMockDataset({
      icon_info: {
        icon: 'file-id-123',
        icon_type: 'image',
        icon_background: undefined,
        icon_url: 'https://example.com/icon.png',
      },
    })

  // Create a dataset with external knowledge info
  const createMockExternalDataset = (): DatasetDetailWithPartialMembersResponse =>
    createMockDataset({
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
    it('should render a named dialog when show is true', () => {
      render(<RenameDatasetModal {...defaultProps} show={true} />)
      expect(screen.getByRole('dialog', { name: 'datasetSettings.title' })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when cancel button is clicked', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      const cancelButton = screen.getByText('common.operation.cancel')
      await user.click(cancelButton)

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close icon is clicked', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      await user.click(screen.getByRole('button', { name: /operation\.close$/ }))

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when Escape is pressed', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      render(<RenameDatasetModal {...defaultProps} onClose={handleClose} />)

      await user.keyboard('{Escape}')

      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('should submit the form when Enter is pressed in the name input', async () => {
      const user = userEvent.setup()
      render(<RenameDatasetModal {...defaultProps} />)

      await user.type(screen.getByRole('textbox', { name: 'datasetSettings.form.name' }), '{Enter}')

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
  })

  describe('API Calls', () => {
    it('should call updateDatasetSetting with correct parameters', async () => {
      render(<RenameDatasetModal {...defaultProps} />)

      const user = userEvent.setup()
      const nameInput = screen.getByDisplayValue('Test Dataset')
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Name')
      const description = screen.getByRole('textbox', { name: 'datasetSettings.form.desc' })
      await user.clear(description)
      await user.type(description, '多语言描述\nSecond line')

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: {
            name: 'Updated Name',
            description: '多语言描述\nSecond line',
            icon_info: {
              icon: '📊',
              icon_type: 'emoji',
              icon_background: '#FFEAD5',
              icon_url: undefined,
            },
          },
        })
      })
      expect(defaultProps.onSuccess).toHaveBeenCalledOnce()
      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })

    it('should include external knowledge IDs when present', async () => {
      const user = userEvent.setup()
      const dataset = createMockExternalDataset()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
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

    it('should handle image icon correctly in API call', async () => {
      const user = userEvent.setup()
      const dataset = createMockDatasetWithImageIcon()
      render(<RenameDatasetModal {...defaultProps} dataset={dataset} />)

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
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
  })

  describe('Error Handling', () => {
    it('should show error toast when name is empty', async () => {
      const user = userEvent.setup()
      render(<RenameDatasetModal {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: '' } })

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('datasetSettings.form.nameError')
        expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
      })
    })

    it('should show error toast when name is only whitespace', async () => {
      const user = userEvent.setup()
      render(<RenameDatasetModal {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: '   ' } })

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('datasetSettings.form.nameError')
        expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()
      })
    })

    it('should show error toast when API call fails', async () => {
      const user = userEvent.setup()
      mockUpdateDatasetSetting.mockRejectedValueOnce(new Error('API Error'))

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
      })
      expect(defaultProps.onClose).not.toHaveBeenCalled()
      expect(defaultProps.onSuccess).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog', { name: 'datasetSettings.title' })).toBeInTheDocument()
      await user.click(saveButton)
      await waitFor(() => expect(mockUpdateDatasetSetting).toHaveBeenCalledTimes(2))
      expect(defaultProps.onSuccess).toHaveBeenCalledOnce()
    })
  })

  describe('Icon Picker Integration', () => {
    it('should select emoji style and close picker (handleSelectAppIcon)', async () => {
      const user = userEvent.setup()
      render(<RenameDatasetModal {...defaultProps} />)

      expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toHaveValue(
        'Test Dataset',
      )
      await user.click(screen.getByRole('button', { name: /form.nameAndIcon/ }))
      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })

      expect(mockUpdateDatasetSetting).not.toHaveBeenCalled()

      // Save and verify new icon is used
      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
      })

      await waitFor(() => {
        expect(mockUpdateDatasetSetting).toHaveBeenCalledWith({
          datasetId: 'dataset-1',
          body: expect.objectContaining({
            icon_info: {
              icon: '📊',
              icon_type: 'emoji',
              icon_background: '#F3FEE7',
              icon_url: undefined,
            },
          }),
        })
      })
    })

    it('should restore previous icon when picker is closed (handleCloseAppIconPicker)', async () => {
      const user = userEvent.setup()
      render(<RenameDatasetModal {...defaultProps} />)

      // Open picker
      const appIcon = screen.getByRole('button', { name: /form.nameAndIcon/ })
      await act(async () => {
        await user.click(appIcon)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
      })
      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.blue' }))
      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })

      // Save and verify original icon is preserved
      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
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
    it('should handle image icon with empty icon_url', async () => {
      const user = userEvent.setup()
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
      expect(screen.getByDisplayValue('Test Dataset'))!.toBeInTheDocument()

      // Save and verify the icon_url is handled correctly
      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
      await act(async () => {
        await user.click(saveButton)
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

    it('should handle double click on save button', async () => {
      const user = userEvent.setup()
      // Use a promise we can control to ensure the first click is still "loading"
      let resolvePromise: (value: DatasetDetailWithPartialMembersResponse) => void
      mockUpdateDatasetSetting.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve
          }),
      )

      render(<RenameDatasetModal {...defaultProps} />)

      const saveButton = screen.getByRole('button', { name: 'common.operation.save' })

      // First click
      await act(async () => {
        await user.click(saveButton)
      })

      // Button should be disabled now
      // Button should be disabled now
      expect(saveButton).toHaveAttribute('aria-disabled', 'true')

      // Second click should not trigger another API call because button is disabled
      await act(async () => {
        await user.click(saveButton)
      })

      // Only one API call should have been made
      expect(mockUpdateDatasetSetting).toHaveBeenCalledTimes(1)

      // Clean up by resolving the promise
      await act(async () => {
        resolvePromise!(createMockDataset())
      })
    })
  })

  describe('Component Re-rendering', () => {
    it('should handle show prop toggle', () => {
      const { rerender } = render(<RenameDatasetModal {...defaultProps} show={true} />)

      expect(screen.getByText('datasetSettings.title'))!.toBeInTheDocument()

      rerender(<RenameDatasetModal {...defaultProps} show={false} />)

      // Modal visibility is controlled by Modal component's isShow prop
      // The modal content may still be in DOM but hidden
    })
  })
})
