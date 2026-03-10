import type { FileEntity } from '@/app/components/datasets/common/image-uploader/types'
import type { Query } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QueryInput from '../index'

// Capture onChange callback so tests can trigger handleImageChange
let capturedOnChange: ((files: FileEntity[]) => void) | null = null
vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing', () => ({
  default: ({ textArea, actionButton, onChange }: { textArea: React.ReactNode, actionButton: React.ReactNode, onChange?: (files: FileEntity[]) => void }) => {
    capturedOnChange = onChange ?? null
    return (
      <div data-testid="image-uploader">
        {textArea}
        {actionButton}
      </div>
    )
  },
}))

vi.mock('@/app/components/datasets/common/retrieval-method-info', () => ({
  getIcon: () => '/test-icon.png',
}))

// Capture onSave callback for external retrieval modal
let _capturedModalOnSave: ((data: { top_k: number, score_threshold: number, score_threshold_enabled: boolean }) => void) | null = null
vi.mock('@/app/components/datasets/hit-testing/modify-external-retrieval-modal', () => ({
  default: ({ onSave, onClose }: { onSave: (data: { top_k: number, score_threshold: number, score_threshold_enabled: boolean }) => void, onClose: () => void }) => {
    _capturedModalOnSave = onSave
    return (
      <div data-testid="external-retrieval-modal">
        <button data-testid="modal-save" onClick={() => onSave({ top_k: 10, score_threshold: 0.8, score_threshold_enabled: true })}>Save</button>
        <button data-testid="modal-close" onClick={onClose}>Close</button>
      </div>
    )
  },
}))

// Capture handleTextChange callback
let _capturedHandleTextChange: ((e: React.ChangeEvent<HTMLTextAreaElement>) => void) | null = null
vi.mock('../textarea', () => ({
  default: ({ text, handleTextChange }: { text: string, handleTextChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void }) => {
    _capturedHandleTextChange = handleTextChange
    return <textarea data-testid="textarea" defaultValue={text} onChange={handleTextChange} />
  },
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: () => false,
}))

describe('QueryInput', () => {
  // Re-create per test to avoid cross-test mutation (handleTextChange mutates query objects)
  const makeDefaultProps = () => ({
    onUpdateList: vi.fn(),
    setHitResult: vi.fn(),
    setExternalHitResult: vi.fn(),
    loading: false,
    queries: [{ content: 'test query', content_type: 'text_query', file_info: null }] satisfies Query[],
    setQueries: vi.fn(),
    isExternal: false,
    onClickRetrievalMethod: vi.fn(),
    retrievalConfig: { search_method: 'semantic_search' } as RetrievalConfig,
    isEconomy: false,
    hitTestingMutation: vi.fn(),
    externalKnowledgeBaseHitTestingMutation: vi.fn(),
  })

  let defaultProps: ReturnType<typeof makeDefaultProps>

  beforeEach(() => {
    vi.clearAllMocks()
    defaultProps = makeDefaultProps()
    capturedOnChange = null
    _capturedModalOnSave = null
    _capturedHandleTextChange = null
  })

  it('should render title', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByText('datasetHitTesting.input.title')).toBeInTheDocument()
  })

  it('should render textarea with query text', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByTestId('textarea')).toBeInTheDocument()
  })

  it('should render submit button', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByRole('button', { name: /input\.testing/ })).toBeInTheDocument()
  })

  it('should disable submit button when text is empty', () => {
    const props = {
      ...defaultProps,
      queries: [{ content: '', content_type: 'text_query', file_info: null }] satisfies Query[],
    }
    render(<QueryInput {...props} />)
    expect(screen.getByRole('button', { name: /input\.testing/ })).toBeDisabled()
  })

  it('should render retrieval method for non-external mode', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
  })

  it('should render settings button for external mode', () => {
    render(<QueryInput {...defaultProps} isExternal={true} />)
    expect(screen.getByText('datasetHitTesting.settingTitle')).toBeInTheDocument()
  })

  it('should disable submit button when text exceeds 200 characters', () => {
    const props = {
      ...defaultProps,
      queries: [{ content: 'a'.repeat(201), content_type: 'text_query', file_info: null }] satisfies Query[],
    }
    render(<QueryInput {...props} />)
    expect(screen.getByRole('button', { name: /input\.testing/ })).toBeDisabled()
  })

  it('should show loading state on submit button when loading', () => {
    render(<QueryInput {...defaultProps} loading={true} />)
    const submitButton = screen.getByRole('button', { name: /input\.testing/ })
    // The real Button component does not disable on loading; it shows a spinner
    expect(submitButton).toBeInTheDocument()
    expect(submitButton.querySelector('[role="status"]')).toBeInTheDocument()
  })

  // Cover line 83: images useMemo with image_query data
  describe('Image Queries', () => {
    it('should parse image_query entries from queries', () => {
      const queries: Query[] = [
        { content: 'test', content_type: 'text_query', file_info: null },
        {
          content: 'https://img.example.com/1.png',
          content_type: 'image_query',
          file_info: { id: 'img-1', name: 'photo.png', size: 1024, mime_type: 'image/png', extension: 'png', source_url: 'https://img.example.com/1.png' },
        },
      ]
      render(<QueryInput {...defaultProps} queries={queries} />)

      // Submit should be enabled since we have text + uploaded image
      expect(screen.getByRole('button', { name: /input\.testing/ })).not.toBeDisabled()
    })
  })

  // Cover lines 106-107: handleSaveExternalRetrievalSettings
  describe('External Retrieval Settings', () => {
    it('should open and close external retrieval modal', () => {
      render(<QueryInput {...defaultProps} isExternal={true} />)

      // Click settings button to open modal
      fireEvent.click(screen.getByRole('button', { name: /settingTitle/ }))
      expect(screen.getByTestId('external-retrieval-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByTestId('modal-close'))
      expect(screen.queryByTestId('external-retrieval-modal')).not.toBeInTheDocument()
    })

    it('should save external retrieval settings and close modal', () => {
      render(<QueryInput {...defaultProps} isExternal={true} />)

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /settingTitle/ }))
      expect(screen.getByTestId('external-retrieval-modal')).toBeInTheDocument()

      // Save settings
      fireEvent.click(screen.getByTestId('modal-save'))
      expect(screen.queryByTestId('external-retrieval-modal')).not.toBeInTheDocument()
    })
  })

  // Cover line 121: handleTextChange when textQuery already exists
  describe('Text Change Handling', () => {
    it('should update existing text query on text change', () => {
      render(<QueryInput {...defaultProps} />)

      const textarea = screen.getByTestId('textarea')
      fireEvent.change(textarea, { target: { value: 'updated text' } })

      expect(defaultProps.setQueries).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'updated text', content_type: 'text_query' }),
        ]),
      )
    })

    it('should create new text query when none exists', () => {
      render(<QueryInput {...defaultProps} queries={[]} />)

      const textarea = screen.getByTestId('textarea')
      fireEvent.change(textarea, { target: { value: 'new text' } })

      expect(defaultProps.setQueries).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: 'new text', content_type: 'text_query' }),
        ]),
      )
    })
  })

  // Cover lines 127-143: handleImageChange
  describe('Image Change Handling', () => {
    it('should update queries when images change', () => {
      render(<QueryInput {...defaultProps} />)

      const files: FileEntity[] = [{
        id: 'f-1',
        name: 'pic.jpg',
        size: 2048,
        mimeType: 'image/jpeg',
        extension: 'jpg',
        sourceUrl: 'https://img.example.com/pic.jpg',
        uploadedId: 'uploaded-1',
        progress: 100,
      }]

      capturedOnChange?.(files)

      expect(defaultProps.setQueries).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content_type: 'text_query' }),
          expect.objectContaining({
            content: 'https://img.example.com/pic.jpg',
            content_type: 'image_query',
            file_info: expect.objectContaining({ id: 'uploaded-1', name: 'pic.jpg' }),
          }),
        ]),
      )
    })

    it('should handle files with missing sourceUrl and uploadedId', () => {
      render(<QueryInput {...defaultProps} />)

      const files: FileEntity[] = [{
        id: 'f-2',
        name: 'no-url.jpg',
        size: 512,
        mimeType: 'image/jpeg',
        extension: 'jpg',
        progress: 100,
        // sourceUrl and uploadedId are undefined
      }]

      capturedOnChange?.(files)

      expect(defaultProps.setQueries).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: '',
            content_type: 'image_query',
            file_info: expect.objectContaining({ id: '', source_url: '' }),
          }),
        ]),
      )
    })

    it('should replace all existing image queries with new ones', () => {
      const queries: Query[] = [
        { content: 'text', content_type: 'text_query', file_info: null },
        { content: 'old-img', content_type: 'image_query', file_info: { id: 'old', name: 'old.png', size: 100, mime_type: 'image/png', extension: 'png', source_url: '' } },
      ]
      render(<QueryInput {...defaultProps} queries={queries} />)

      capturedOnChange?.([])

      // Should keep text query but remove all image queries
      expect(defaultProps.setQueries).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content_type: 'text_query' }),
        ]),
      )
      // Should not contain image_query
      const calledWith = defaultProps.setQueries.mock.calls[0][0] as Query[]
      expect(calledWith.filter(q => q.content_type === 'image_query')).toHaveLength(0)
    })
  })

  // Cover lines 146-162: onSubmit (hit testing mutation)
  describe('Submit Handlers', () => {
    it('should call hitTestingMutation on submit for non-external mode', async () => {
      const mockMutation = vi.fn(async (_req, opts) => {
        const response = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
        opts?.onSuccess?.(response)
        return response
      })

      render(<QueryInput {...defaultProps} hitTestingMutation={mockMutation} />)

      fireEvent.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'test query',
            retrieval_model: expect.objectContaining({ search_method: 'semantic_search' }),
          }),
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        )
      })
      expect(defaultProps.setHitResult).toHaveBeenCalled()
      expect(defaultProps.onUpdateList).toHaveBeenCalled()
    })

    it('should call onSubmit callback after successful hit testing', async () => {
      const mockOnSubmit = vi.fn()
      const mockMutation = vi.fn(async (_req, opts) => {
        const response = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
        opts?.onSuccess?.(response)
        return response
      })

      render(<QueryInput {...defaultProps} hitTestingMutation={mockMutation} onSubmit={mockOnSubmit} />)

      fireEvent.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled()
      })
    })

    it('should use keywordSearch when isEconomy is true', async () => {
      const mockResponse = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
      const mockMutation = vi.fn(async (_req, opts) => {
        opts?.onSuccess?.(mockResponse)
        return mockResponse
      })

      render(<QueryInput {...defaultProps} hitTestingMutation={mockMutation} isEconomy={true} />)

      fireEvent.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            retrieval_model: expect.objectContaining({ search_method: 'keyword_search' }),
          }),
          expect.anything(),
        )
      })
    })

    // Cover lines 164-178: externalRetrievalTestingOnSubmit
    it('should call externalKnowledgeBaseHitTestingMutation for external mode', async () => {
      const mockExternalMutation = vi.fn(async (_req, opts) => {
        const response = { query: { content: '' }, records: [] }
        opts?.onSuccess?.(response)
        return response
      })

      render(<QueryInput {...defaultProps} isExternal={true} externalKnowledgeBaseHitTestingMutation={mockExternalMutation} />)

      fireEvent.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockExternalMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'test query',
            external_retrieval_model: expect.objectContaining({
              top_k: 4,
              score_threshold: 0.5,
              score_threshold_enabled: false,
            }),
          }),
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        )
      })
      expect(defaultProps.setExternalHitResult).toHaveBeenCalled()
      expect(defaultProps.onUpdateList).toHaveBeenCalled()
    })

    it('should include image attachment_ids in submit request', async () => {
      const queries: Query[] = [
        { content: 'test', content_type: 'text_query', file_info: null },
        { content: 'img-url', content_type: 'image_query', file_info: { id: 'img-id', name: 'pic.png', size: 100, mime_type: 'image/png', extension: 'png', source_url: 'img-url' } },
      ]
      const mockResponse = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
      const mockMutation = vi.fn(async (_req, opts) => {
        opts?.onSuccess?.(mockResponse)
        return mockResponse
      })

      render(<QueryInput {...defaultProps} queries={queries} hitTestingMutation={mockMutation} />)

      fireEvent.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            // uploadedId is mapped from file_info.id
            attachment_ids: expect.arrayContaining(['img-id']),
          }),
          expect.anything(),
        )
      })
    })
  })

  // Cover lines 217-238: retrieval method click handler
  describe('Retrieval Method', () => {
    it('should call onClickRetrievalMethod when retrieval method is clicked', () => {
      render(<QueryInput {...defaultProps} />)

      fireEvent.click(screen.getByText('dataset.retrieval.semantic_search.title'))

      expect(defaultProps.onClickRetrievalMethod).toHaveBeenCalled()
    })

    it('should show keyword_search when isEconomy is true', () => {
      render(<QueryInput {...defaultProps} isEconomy={true} />)

      expect(screen.getByText('dataset.retrieval.keyword_search.title')).toBeInTheDocument()
    })
  })
})
