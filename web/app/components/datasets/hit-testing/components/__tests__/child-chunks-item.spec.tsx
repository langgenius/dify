import type { HitTestingChildChunk } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChildChunksItem from '../child-chunks-item'

const createChildChunkPayload = (
  overrides: Partial<HitTestingChildChunk> = {},
): HitTestingChildChunk => ({
  id: 'chunk-1',
  content: 'Child chunk content here',
  position: 1,
  score: 0.75,
  ...overrides,
})

describe('ChildChunksItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for child chunk items
  describe('Rendering', () => {
    it('should render the position label', () => {
      const payload = createChildChunkPayload({ position: 3 })

      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      expect(screen.getByText(/C-/)).toBeInTheDocument()
      expect(screen.getByText(/3/)).toBeInTheDocument()
    })

    it('should render the score component', () => {
      const payload = createChildChunkPayload({ score: 0.88 })

      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      expect(screen.getByText('0.88')).toBeInTheDocument()
    })

    it('should render the content text', () => {
      const payload = createChildChunkPayload({ content: 'Sample chunk text' })

      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      expect(screen.getByText('Sample chunk text')).toBeInTheDocument()
    })

    it('should render with besideChunkName styling on Score', () => {
      const payload = createChildChunkPayload({ score: 0.6 })

      const { container } = render(
        <ChildChunksItem payload={payload} isShowAll={false} />,
      )

      // Assert - Score with besideChunkName has h-[20.5px] and border-l-0
      const scoreEl = container.querySelector('[class*="h-\\[20\\.5px\\]"]')
      expect(scoreEl).toBeInTheDocument()
    })
  })

  // Line clamping behavior tests
  describe('Line Clamping', () => {
    it('should apply line-clamp-2 when isShowAll is false', () => {
      const payload = createChildChunkPayload()

      const { container } = render(
        <ChildChunksItem payload={payload} isShowAll={false} />,
      )

      const root = container.firstElementChild
      expect(root?.className).toContain('line-clamp-2')
    })

    it('should not apply line-clamp-2 when isShowAll is true', () => {
      const payload = createChildChunkPayload()

      const { container } = render(
        <ChildChunksItem payload={payload} isShowAll={true} />,
      )

      const root = container.firstElementChild
      expect(root?.className).not.toContain('line-clamp-2')
    })
  })

  describe('Edge Cases', () => {
    it('should render with score 0 (Score returns null)', () => {
      const payload = createChildChunkPayload({ score: 0 })

      render(<ChildChunksItem payload={payload} isShowAll={false} />)

      // Assert - content still renders, score returns null
      expect(screen.getByText('Child chunk content here')).toBeInTheDocument()
      expect(screen.queryByText('score')).not.toBeInTheDocument()
    })
  })
})
