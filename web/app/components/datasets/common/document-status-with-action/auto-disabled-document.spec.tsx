import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'

import { useAutoDisabledDocuments } from '@/service/knowledge/use-document'
import AutoDisabledDocument from './auto-disabled-document'

type AutoDisabledDocumentsResponse = { document_ids: string[] }

const createMockQueryResult = (
  data: AutoDisabledDocumentsResponse | undefined,
  isLoading: boolean,
) => ({
  data,
  isLoading,
}) as ReturnType<typeof useAutoDisabledDocuments>

// Mock service hooks
const mockMutateAsync = vi.fn()
const mockInvalidDisabledDocument = vi.fn()

vi.mock('@/service/knowledge/use-document', () => ({
  useAutoDisabledDocuments: vi.fn(),
  useDocumentEnable: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
  })),
  useInvalidDisabledDocument: vi.fn(() => mockInvalidDisabledDocument),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

const mockUseAutoDisabledDocuments = vi.mocked(useAutoDisabledDocuments)

describe('AutoDisabledDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue({})
  })

  describe('Rendering', () => {
    it('should render nothing when loading', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult(undefined, true),
      )

      const { container } = render(<AutoDisabledDocument datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when no disabled documents', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: [] }, false),
      )

      const { container } = render(<AutoDisabledDocument datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when document_ids is undefined', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult(undefined, false),
      )

      const { container } = render(<AutoDisabledDocument datasetId="test-dataset" />)
      expect(container.firstChild).toBeNull()
    })

    it('should render StatusWithAction when disabled documents exist', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: ['doc1', 'doc2'] }, false),
      )

      render(<AutoDisabledDocument datasetId="test-dataset" />)
      expect(screen.getByText(/enable/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass datasetId to useAutoDisabledDocuments', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: [] }, false),
      )

      render(<AutoDisabledDocument datasetId="my-dataset-id" />)
      expect(mockUseAutoDisabledDocuments).toHaveBeenCalledWith('my-dataset-id')
    })
  })

  describe('User Interactions', () => {
    it('should call enableDocument when action button is clicked', async () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: ['doc1', 'doc2'] }, false),
      )

      render(<AutoDisabledDocument datasetId="test-dataset" />)

      const actionButton = screen.getByText(/enable/i)
      fireEvent.click(actionButton)

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          datasetId: 'test-dataset',
          documentIds: ['doc1', 'doc2'],
        })
      })
    })

    it('should invalidate cache after enabling documents', async () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: ['doc1'] }, false),
      )

      render(<AutoDisabledDocument datasetId="test-dataset" />)

      const actionButton = screen.getByText(/enable/i)
      fireEvent.click(actionButton)

      await waitFor(() => {
        expect(mockInvalidDisabledDocument).toHaveBeenCalled()
      })
    })

    it('should show success toast after enabling documents', async () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: ['doc1'] }, false),
      )

      render(<AutoDisabledDocument datasetId="test-dataset" />)

      const actionButton = screen.getByText(/enable/i)
      fireEvent.click(actionButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'success',
          message: expect.any(String),
        })
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle single disabled document', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: ['doc1'] }, false),
      )

      render(<AutoDisabledDocument datasetId="test-dataset" />)
      expect(screen.getByText(/enable/i)).toBeInTheDocument()
    })

    it('should handle multiple disabled documents', () => {
      mockUseAutoDisabledDocuments.mockReturnValue(
        createMockQueryResult({ document_ids: ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'] }, false),
      )

      render(<AutoDisabledDocument datasetId="test-dataset" />)
      expect(screen.getByText(/enable/i)).toBeInTheDocument()
    })
  })
})
