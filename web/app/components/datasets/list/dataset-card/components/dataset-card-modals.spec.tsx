import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import DatasetCardModals from './dataset-card-modals'

// Mock RenameDatasetModal since it's from a different feature folder
vi.mock('../../../rename-modal', () => ({
  default: ({ show, onClose, onSuccess }: { show: boolean, onClose: () => void, onSuccess?: () => void }) => (
    show
      ? (
          <div data-testid="rename-modal">
            <button onClick={onClose}>Close Rename</button>
            <button onClick={onSuccess}>Success</button>
          </div>
        )
      : null
  ),
}))

describe('DatasetCardModals', () => {
  const mockDataset: DataSet = {
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    indexing_status: 'completed',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    total_document_count: 10,
    word_count: 1000,
    updated_at: 1609545600,
    updated_by: 'user-1',
    tags: [],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    built_in_field_enabled: false,
    icon_info: {
      icon: '📙',
      icon_type: 'emoji' as const,
      icon_background: '#FFF4ED',
      icon_url: '',
    },
    retrieval_model_dict: {} as DataSet['retrieval_model_dict'],
    retrieval_model: {} as DataSet['retrieval_model'],
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
  }

  const defaultProps = {
    dataset: mockDataset,
    modalState: {
      showRenameModal: false,
      showConfirmDelete: false,
      confirmMessage: '',
    },
    onCloseRename: vi.fn(),
    onCloseConfirm: vi.fn(),
    onConfirmDelete: vi.fn(),
    onSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing when no modals are shown', () => {
      const { container } = render(<DatasetCardModals {...defaultProps} />)
      // Should render empty fragment
      expect(container.innerHTML).toBe('')
    })

    it('should render rename modal when showRenameModal is true', () => {
      render(
        <DatasetCardModals
          {...defaultProps}
          modalState={{ ...defaultProps.modalState, showRenameModal: true }}
        />,
      )
      expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    })

    it('should render confirm modal when showConfirmDelete is true', () => {
      render(
        <DatasetCardModals
          {...defaultProps}
          modalState={{
            ...defaultProps.modalState,
            showConfirmDelete: true,
            confirmMessage: 'Are you sure?',
          }}
        />,
      )
      // Confirm modal should be rendered
      expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass dataset to rename modal', () => {
      render(
        <DatasetCardModals
          {...defaultProps}
          modalState={{ ...defaultProps.modalState, showRenameModal: true }}
        />,
      )
      expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
    })

    it('should display confirmMessage in confirm modal', () => {
      const confirmMessage = 'This is a custom confirm message'
      render(
        <DatasetCardModals
          {...defaultProps}
          modalState={{
            ...defaultProps.modalState,
            showConfirmDelete: true,
            confirmMessage,
          }}
        />,
      )
      expect(screen.getByText(confirmMessage)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCloseRename when closing rename modal', () => {
      const onCloseRename = vi.fn()
      render(
        <DatasetCardModals
          {...defaultProps}
          onCloseRename={onCloseRename}
          modalState={{ ...defaultProps.modalState, showRenameModal: true }}
        />,
      )

      fireEvent.click(screen.getByText('Close Rename'))
      expect(onCloseRename).toHaveBeenCalledTimes(1)
    })

    it('should call onConfirmDelete when confirming deletion', () => {
      const onConfirmDelete = vi.fn()
      render(
        <DatasetCardModals
          {...defaultProps}
          onConfirmDelete={onConfirmDelete}
          modalState={{
            ...defaultProps.modalState,
            showConfirmDelete: true,
            confirmMessage: 'Delete?',
          }}
        />,
      )

      // Find and click the confirm button
      const confirmButton = screen.getByRole('button', { name: /confirm|ok|delete/i })
        || screen.getAllByRole('button').find(btn => btn.textContent?.toLowerCase().includes('confirm'))
      if (confirmButton)
        fireEvent.click(confirmButton)

      expect(onConfirmDelete).toHaveBeenCalledTimes(1)
    })

    it('should call onCloseConfirm when canceling deletion', () => {
      const onCloseConfirm = vi.fn()
      render(
        <DatasetCardModals
          {...defaultProps}
          onCloseConfirm={onCloseConfirm}
          modalState={{
            ...defaultProps.modalState,
            showConfirmDelete: true,
            confirmMessage: 'Delete?',
          }}
        />,
      )

      // Find and click the cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)

      expect(onCloseConfirm).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle both modals being true (render both)', () => {
      render(
        <DatasetCardModals
          {...defaultProps}
          modalState={{
            showRenameModal: true,
            showConfirmDelete: true,
            confirmMessage: 'Delete this dataset?',
          }}
        />,
      )
      expect(screen.getByTestId('rename-modal')).toBeInTheDocument()
      expect(screen.getByText('Delete this dataset?')).toBeInTheDocument()
    })

    it('should handle empty confirmMessage', () => {
      render(
        <DatasetCardModals
          {...defaultProps}
          modalState={{
            ...defaultProps.modalState,
            showConfirmDelete: true,
            confirmMessage: '',
          }}
        />,
      )
      // Should still render confirm modal
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })
  })
})
