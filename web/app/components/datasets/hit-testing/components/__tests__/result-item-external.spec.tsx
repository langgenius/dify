import type { ExternalKnowledgeBaseHitTesting } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResultItemExternal from '../result-item-external'

let mockIsShowDetailModal = false
const mockShowDetailModal = vi.fn(() => {
  mockIsShowDetailModal = true
})
const mockHideDetailModal = vi.fn(() => {
  mockIsShowDetailModal = false
})

// Mock useBoolean: required because tests control modal state externally
// (setting mockIsShowDetailModal before render) and verify mock fn calls.
vi.mock('ahooks', () => ({
  useBoolean: (_initial: boolean) => {
    return [
      mockIsShowDetailModal,
      {
        setTrue: mockShowDetailModal,
        setFalse: mockHideDetailModal,
        toggle: vi.fn(),
        set: vi.fn(),
      },
    ]
  },
}))

const createExternalPayload = (
  overrides: Partial<ExternalKnowledgeBaseHitTesting> = {},
): ExternalKnowledgeBaseHitTesting => ({
  content: 'This is the chunk content for testing.',
  title: 'Test Document Title',
  score: 0.85,
  metadata: {
    'x-amz-bedrock-kb-source-uri': 's3://bucket/key',
    'x-amz-bedrock-kb-data-source-id': 'ds-123',
  },
  ...overrides,
})

describe('ResultItemExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsShowDetailModal = false
  })

  // Rendering tests for the external result item card
  describe('Rendering', () => {
    it('should render the content text', () => {
      const payload = createExternalPayload({ content: 'External result content' })

      render(<ResultItemExternal payload={payload} positionId={1} />)

      expect(screen.getByText('External result content')).toBeInTheDocument()
    })

    it('should render the meta info with position and score', () => {
      const payload = createExternalPayload({ score: 0.92 })

      render(<ResultItemExternal payload={payload} positionId={5} />)

      expect(screen.getByText('Chunk-05')).toBeInTheDocument()
      expect(screen.getByText('0.92')).toBeInTheDocument()
    })

    it('should render the footer with document title', () => {
      const payload = createExternalPayload({ title: 'Knowledge Base Doc' })

      render(<ResultItemExternal payload={payload} positionId={1} />)

      expect(screen.getByText('Knowledge Base Doc')).toBeInTheDocument()
    })

    it('should render the word count from content length', () => {
      const content = 'Hello World' // 11 chars
      const payload = createExternalPayload({ content })

      render(<ResultItemExternal payload={payload} positionId={1} />)

      expect(screen.getByText(/11/)).toBeInTheDocument()
    })
  })

  // Detail modal tests
  describe('Detail Modal', () => {
    it('should not render modal by default', () => {
      const payload = createExternalPayload()

      render(<ResultItemExternal payload={payload} positionId={1} />)

      expect(screen.queryByText(/chunkDetail/i)).not.toBeInTheDocument()
    })

    it('should call showDetailModal when card is clicked', () => {
      const payload = createExternalPayload()
      mockIsShowDetailModal = false

      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Act - click the card to open modal
      const card = screen.getByText(payload.content).closest('.cursor-pointer') as HTMLElement
      fireEvent.click(card)

      // Assert - showDetailModal (setTrue) was invoked
      expect(mockShowDetailModal).toHaveBeenCalled()
    })

    it('should render modal content when isShowDetailModal is true', () => {
      // Arrange - modal is already open
      const payload = createExternalPayload()
      mockIsShowDetailModal = true

      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - modal title should appear
      expect(screen.getByText(/chunkDetail/i)).toBeInTheDocument()
    })

    it('should render full content in the modal', () => {
      const payload = createExternalPayload({ content: 'Full modal content text' })
      mockIsShowDetailModal = true

      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - content appears both in card and modal
      const contentElements = screen.getAllByText('Full modal content text')
      expect(contentElements.length).toBeGreaterThanOrEqual(2)
    })

    it('should render meta info in the modal', () => {
      const payload = createExternalPayload({ score: 0.77 })
      mockIsShowDetailModal = true

      render(<ResultItemExternal payload={payload} positionId={3} />)

      // Assert - meta appears in both card and modal
      const chunkTags = screen.getAllByText('Chunk-03')
      expect(chunkTags.length).toBe(2)
      const scores = screen.getAllByText('0.77')
      expect(scores.length).toBe(2)
    })
  })

  describe('Edge Cases', () => {
    it('should render with empty content', () => {
      const payload = createExternalPayload({ content: '' })

      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - component still renders
      expect(screen.getByText('Test Document Title')).toBeInTheDocument()
    })

    it('should render with score of 0 (Score returns null)', () => {
      const payload = createExternalPayload({ score: 0 })

      render(<ResultItemExternal payload={payload} positionId={1} />)

      // Assert - no score displayed
      expect(screen.queryByText('score')).not.toBeInTheDocument()
    })

    it('should handle large positionId values', () => {
      const payload = createExternalPayload()

      render(<ResultItemExternal payload={payload} positionId={999} />)

      expect(screen.getByText('Chunk-999')).toBeInTheDocument()
    })
  })
})
