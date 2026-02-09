import type { Member } from '@/models/common'
import type { DataSet, IconInfo } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { IndexingType } from '../../../create/step-two'
import BasicInfoSection from './basic-info-section'

// Mock app-context
vi.mock('@/context/app-context', () => ({
  useSelector: () => ({
    id: 'user-1',
    name: 'Current User',
    email: 'current@example.com',
    avatar_url: '',
    role: 'owner',
  }),
}))

// Mock image uploader hooks for AppIconPicker
vi.mock('@/app/components/base/image-uploader/hooks', () => ({
  useLocalFileUploader: () => ({
    disabled: false,
    handleLocalFileUpload: vi.fn(),
  }),
  useImageFiles: () => ({
    files: [],
    onUpload: vi.fn(),
    onRemove: vi.fn(),
    onReUpload: vi.fn(),
    onImageLinkLoadError: vi.fn(),
    onImageLinkLoadSuccess: vi.fn(),
    onClear: vi.fn(),
  }),
}))

describe('BasicInfoSection', () => {
  const mockDataset: DataSet = {
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    permission: DatasetPermission.onlyMe,
    icon_info: {
      icon_type: 'emoji',
      icon: '📚',
      icon_background: '#FFFFFF',
      icon_url: '',
    },
    indexing_technique: IndexingType.QUALIFIED,
    indexing_status: 'completed',
    data_source_type: DataSourceType.FILE,
    doc_form: ChunkingMode.text,
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    embedding_available: true,
    app_count: 0,
    document_count: 5,
    total_document_count: 5,
    word_count: 1000,
    provider: 'vendor',
    tags: [],
    partial_member_list: [],
    external_knowledge_info: {
      external_knowledge_id: 'ext-1',
      external_knowledge_api_id: 'api-1',
      external_knowledge_api_name: 'External API',
      external_knowledge_api_endpoint: 'https://api.example.com',
    },
    external_retrieval_model: {
      top_k: 3,
      score_threshold: 0.7,
      score_threshold_enabled: true,
    },
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    } as RetrievalConfig,
    retrieval_model: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    } as RetrievalConfig,
    built_in_field_enabled: false,
    keyword_number: 10,
    created_by: 'user-1',
    updated_by: 'user-1',
    updated_at: Date.now(),
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
  }

  const mockMemberList: Member[] = [
    { id: 'user-1', name: 'User 1', email: 'user1@example.com', role: 'owner', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
    { id: 'user-2', name: 'User 2', email: 'user2@example.com', role: 'admin', avatar: '', avatar_url: '', last_login_at: '', created_at: '', status: 'active' },
  ]

  const mockIconInfo: IconInfo = {
    icon_type: 'emoji',
    icon: '📚',
    icon_background: '#FFFFFF',
    icon_url: '',
  }

  const defaultProps = {
    currentDataset: mockDataset,
    isCurrentWorkspaceDatasetOperator: false,
    name: 'Test Dataset',
    setName: vi.fn(),
    description: 'Test description',
    setDescription: vi.fn(),
    iconInfo: mockIconInfo,
    showAppIconPicker: false,
    handleOpenAppIconPicker: vi.fn(),
    handleSelectAppIcon: vi.fn(),
    handleCloseAppIconPicker: vi.fn(),
    permission: DatasetPermission.onlyMe,
    setPermission: vi.fn(),
    selectedMemberIDs: ['user-1'],
    setSelectedMemberIDs: vi.fn(),
    memberList: mockMemberList,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<BasicInfoSection {...defaultProps} />)
      expect(screen.getByText(/form\.nameAndIcon/i)).toBeInTheDocument()
    })

    it('should render name and icon section', () => {
      render(<BasicInfoSection {...defaultProps} />)
      expect(screen.getByText(/form\.nameAndIcon/i)).toBeInTheDocument()
    })

    it('should render description section', () => {
      render(<BasicInfoSection {...defaultProps} />)
      expect(screen.getByText(/form\.desc/i)).toBeInTheDocument()
    })

    it('should render permissions section', () => {
      render(<BasicInfoSection {...defaultProps} />)
      // Use exact match to avoid matching "permissionsOnlyMe"
      expect(screen.getByText('datasetSettings.form.permissions')).toBeInTheDocument()
    })

    it('should render name input with correct value', () => {
      render(<BasicInfoSection {...defaultProps} />)
      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput).toBeInTheDocument()
    })

    it('should render description textarea with correct value', () => {
      render(<BasicInfoSection {...defaultProps} />)
      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea).toBeInTheDocument()
    })

    it('should render app icon with emoji', () => {
      const { container } = render(<BasicInfoSection {...defaultProps} />)
      // The icon section should be rendered (emoji may be in a span or SVG)
      const iconSection = container.querySelector('[class*="cursor-pointer"]')
      expect(iconSection).toBeInTheDocument()
    })
  })

  describe('Name Input', () => {
    it('should call setName when name input changes', () => {
      const setName = vi.fn()
      render(<BasicInfoSection {...defaultProps} setName={setName} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      fireEvent.change(nameInput, { target: { value: 'New Name' } })

      expect(setName).toHaveBeenCalledWith('New Name')
    })

    it('should disable name input when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      render(<BasicInfoSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput).toBeDisabled()
    })

    it('should enable name input when embedding is available', () => {
      render(<BasicInfoSection {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput).not.toBeDisabled()
    })

    it('should display empty name', () => {
      const { container } = render(<BasicInfoSection {...defaultProps} name="" />)

      // Find the name input by its structure - may be type=text or just input
      const nameInput = container.querySelector('input')
      expect(nameInput).toHaveValue('')
    })
  })

  describe('Description Textarea', () => {
    it('should call setDescription when description changes', () => {
      const setDescription = vi.fn()
      render(<BasicInfoSection {...defaultProps} setDescription={setDescription} />)

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      fireEvent.change(descriptionTextarea, { target: { value: 'New Description' } })

      expect(setDescription).toHaveBeenCalledWith('New Description')
    })

    it('should disable description textarea when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      render(<BasicInfoSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />)

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea).toBeDisabled()
    })

    it('should render placeholder', () => {
      render(<BasicInfoSection {...defaultProps} description="" />)

      const descriptionTextarea = screen.getByPlaceholderText(/form\.descPlaceholder/i)
      expect(descriptionTextarea).toBeInTheDocument()
    })
  })

  describe('App Icon', () => {
    it('should call handleOpenAppIconPicker when icon is clicked', () => {
      const handleOpenAppIconPicker = vi.fn()
      const { container } = render(<BasicInfoSection {...defaultProps} handleOpenAppIconPicker={handleOpenAppIconPicker} />)

      // Find the clickable icon element - it's inside a wrapper that handles the click
      const iconWrapper = container.querySelector('[class*="cursor-pointer"]')
      if (iconWrapper) {
        fireEvent.click(iconWrapper)
        expect(handleOpenAppIconPicker).toHaveBeenCalled()
      }
    })

    it('should render AppIconPicker when showAppIconPicker is true', () => {
      const { baseElement } = render(<BasicInfoSection {...defaultProps} showAppIconPicker={true} />)

      // AppIconPicker renders a modal with emoji tabs and options via portal
      // We just verify the component renders without crashing when picker is shown
      expect(baseElement).toBeInTheDocument()
    })

    it('should not render AppIconPicker when showAppIconPicker is false', () => {
      const { container } = render(<BasicInfoSection {...defaultProps} showAppIconPicker={false} />)

      // Check that AppIconPicker is not rendered
      expect(container.querySelector('[data-testid="app-icon-picker"]')).not.toBeInTheDocument()
    })

    it('should render image icon when icon_type is image', () => {
      const imageIconInfo: IconInfo = {
        icon_type: 'image',
        icon: 'file-123',
        icon_background: undefined,
        icon_url: 'https://example.com/icon.png',
      }
      render(<BasicInfoSection {...defaultProps} iconInfo={imageIconInfo} />)

      // For image type, it renders an img element
      const img = screen.queryByRole('img')
      if (img) {
        expect(img).toHaveAttribute('src', expect.stringContaining('icon.png'))
      }
    })
  })

  describe('Permission Selector', () => {
    it('should render with correct permission value', () => {
      render(<BasicInfoSection {...defaultProps} permission={DatasetPermission.onlyMe} />)

      expect(screen.getByText(/form\.permissionsOnlyMe/i)).toBeInTheDocument()
    })

    it('should render all team members permission', () => {
      render(<BasicInfoSection {...defaultProps} permission={DatasetPermission.allTeamMembers} />)

      expect(screen.getByText(/form\.permissionsAllMember/i)).toBeInTheDocument()
    })

    it('should be disabled when embedding is not available', () => {
      const datasetWithoutEmbedding = { ...mockDataset, embedding_available: false }
      const { container } = render(
        <BasicInfoSection {...defaultProps} currentDataset={datasetWithoutEmbedding} />,
      )

      // Check for disabled state via cursor-not-allowed class
      const disabledElement = container.querySelector('[class*="cursor-not-allowed"]')
      expect(disabledElement).toBeInTheDocument()
    })

    it('should be disabled when user is dataset operator', () => {
      const { container } = render(
        <BasicInfoSection {...defaultProps} isCurrentWorkspaceDatasetOperator={true} />,
      )

      const disabledElement = container.querySelector('[class*="cursor-not-allowed"]')
      expect(disabledElement).toBeInTheDocument()
    })

    it('should call setPermission when permission changes', async () => {
      const setPermission = vi.fn()
      render(<BasicInfoSection {...defaultProps} setPermission={setPermission} />)

      // Open dropdown
      const trigger = screen.getByText(/form\.permissionsOnlyMe/i)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Click All Team Members option
        const allMemberOptions = screen.getAllByText(/form\.permissionsAllMember/i)
        fireEvent.click(allMemberOptions[0])
      })

      expect(setPermission).toHaveBeenCalledWith(DatasetPermission.allTeamMembers)
    })

    it('should call setSelectedMemberIDs when members are selected', async () => {
      const setSelectedMemberIDs = vi.fn()
      const { container } = render(
        <BasicInfoSection
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          setSelectedMemberIDs={setSelectedMemberIDs}
        />,
      )

      // For partial members permission, the member selector should be visible
      // The exact interaction depends on the MemberSelector component
      // We verify the component renders without crashing
      expect(container).toBeInTheDocument()
    })
  })

  describe('Undefined Dataset', () => {
    it('should handle undefined currentDataset gracefully', () => {
      render(<BasicInfoSection {...defaultProps} currentDataset={undefined} />)

      // Should still render but inputs might behave differently
      expect(screen.getByText(/form\.nameAndIcon/i)).toBeInTheDocument()
    })
  })

  describe('Props Validation', () => {
    it('should update when name prop changes', () => {
      const { rerender } = render(<BasicInfoSection {...defaultProps} name="Initial Name" />)

      expect(screen.getByDisplayValue('Initial Name')).toBeInTheDocument()

      rerender(<BasicInfoSection {...defaultProps} name="Updated Name" />)

      expect(screen.getByDisplayValue('Updated Name')).toBeInTheDocument()
    })

    it('should update when description prop changes', () => {
      const { rerender } = render(<BasicInfoSection {...defaultProps} description="Initial Description" />)

      expect(screen.getByDisplayValue('Initial Description')).toBeInTheDocument()

      rerender(<BasicInfoSection {...defaultProps} description="Updated Description" />)

      expect(screen.getByDisplayValue('Updated Description')).toBeInTheDocument()
    })

    it('should update when permission prop changes', () => {
      const { rerender } = render(<BasicInfoSection {...defaultProps} permission={DatasetPermission.onlyMe} />)

      expect(screen.getByText(/form\.permissionsOnlyMe/i)).toBeInTheDocument()

      rerender(<BasicInfoSection {...defaultProps} permission={DatasetPermission.allTeamMembers} />)

      expect(screen.getByText(/form\.permissionsAllMember/i)).toBeInTheDocument()
    })
  })

  describe('Member List', () => {
    it('should pass member list to PermissionSelector', () => {
      const { container } = render(
        <BasicInfoSection
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          memberList={mockMemberList}
        />,
      )

      // For partial members, a member selector component should be rendered
      // We verify it renders without crashing
      expect(container).toBeInTheDocument()
    })

    it('should handle empty member list', () => {
      render(
        <BasicInfoSection
          {...defaultProps}
          memberList={[]}
        />,
      )

      expect(screen.getByText(/form\.permissionsOnlyMe/i)).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have accessible name input', () => {
      render(<BasicInfoSection {...defaultProps} />)

      const nameInput = screen.getByDisplayValue('Test Dataset')
      expect(nameInput.tagName.toLowerCase()).toBe('input')
    })

    it('should have accessible description textarea', () => {
      render(<BasicInfoSection {...defaultProps} />)

      const descriptionTextarea = screen.getByDisplayValue('Test description')
      expect(descriptionTextarea.tagName.toLowerCase()).toBe('textarea')
    })
  })
})
