import type { ParentChildChunk } from '../types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'

import ChunkCard from '../chunk-card'

vi.mock('@/app/components/datasets/documents/detail/completed/common/dot', () => ({
  default: () => <span data-testid="dot" />,
}))

vi.mock('@/app/components/datasets/documents/detail/completed/common/segment-index-tag', () => ({
  default: ({ positionId, labelPrefix }: { positionId?: string | number, labelPrefix: string }) => (
    <span data-testid="segment-tag">
      {labelPrefix}
      -
      {positionId}
    </span>
  ),
}))

vi.mock('@/app/components/datasets/documents/detail/completed/common/summary-label', () => ({
  default: ({ summary }: { summary: string }) => <span data-testid="summary">{summary}</span>,
}))

vi.mock('@/app/components/datasets/formatted-text/flavours/preview-slice', () => ({
  PreviewSlice: ({ label, text }: { label: string, text: string }) => (
    <span data-testid="preview-slice">
      {label}
      :
      {' '}
      {text}
    </span>
  ),
}))

vi.mock('@/models/datasets', () => ({
  ChunkingMode: {
    text: 'text',
    parentChild: 'parent-child',
    qa: 'qa',
  },
}))

vi.mock('@/utils/format', () => ({
  formatNumber: (n: number) => String(n),
}))

vi.mock('../q-a-item', () => ({
  default: ({ type, text }: { type: string, text: string }) => (
    <span data-testid={`qa-${type}`}>{text}</span>
  ),
}))

vi.mock('../types', () => ({
  QAItemType: {
    Question: 'question',
    Answer: 'answer',
  },
}))

const makeParentChildContent = (overrides: Partial<ParentChildChunk> = {}): ParentChildChunk => ({
  child_contents: ['Child'],
  parent_content: '',
  parent_summary: '',
  parent_mode: 'paragraph',
  ...overrides,
})

describe('ChunkCard', () => {
  describe('Text mode', () => {
    it('should render text content', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={{ content: 'Hello world', summary: 'Summary text' }}
          positionId={1}
          wordCount={42}
        />,
      )

      expect(screen.getByText('Hello world')).toBeInTheDocument()
    })

    it('should render segment index tag with Chunk prefix', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={{ content: 'Test', summary: '' }}
          positionId={5}
          wordCount={10}
        />,
      )

      expect(screen.getByText('Chunk-5')).toBeInTheDocument()
    })

    it('should render word count', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={{ content: 'Test', summary: '' }}
          positionId={1}
          wordCount={100}
        />,
      )

      expect(screen.getByText(/100/)).toBeInTheDocument()
    })

    it('should render summary when available', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.text}
          content={{ content: 'Test', summary: 'A summary' }}
          positionId={1}
          wordCount={10}
        />,
      )

      expect(screen.getByTestId('summary')).toHaveTextContent('A summary')
    })
  })

  describe('Parent-Child mode (paragraph)', () => {
    it('should render child contents as preview slices', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={makeParentChildContent({
            child_contents: ['Child 1', 'Child 2'],
            parent_summary: 'Parent summary',
          })}
          positionId={3}
          wordCount={50}
        />,
      )

      const slices = screen.getAllByTestId('preview-slice')
      expect(slices).toHaveLength(2)
      expect(slices[0]).toHaveTextContent('C-1: Child 1')
      expect(slices[1]).toHaveTextContent('C-2: Child 2')
    })

    it('should render Parent-Chunk prefix for paragraph mode', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={makeParentChildContent()}
          positionId={2}
          wordCount={20}
        />,
      )

      expect(screen.getByText('Parent-Chunk-2')).toBeInTheDocument()
    })

    it('should render parent summary', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="paragraph"
          content={makeParentChildContent({
            child_contents: ['C1'],
            parent_summary: 'Overview',
          })}
          positionId={1}
          wordCount={10}
        />,
      )

      expect(screen.getByTestId('summary')).toHaveTextContent('Overview')
    })
  })

  describe('Parent-Child mode (full-doc)', () => {
    it('should hide segment tag in full-doc mode', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.parentChild}
          parentMode="full-doc"
          content={makeParentChildContent({
            child_contents: ['Full doc child'],
            parent_mode: 'full-doc',
          })}
          positionId={1}
          wordCount={300}
        />,
      )

      expect(screen.queryByTestId('segment-tag')).not.toBeInTheDocument()
    })
  })

  describe('QA mode', () => {
    it('should render question and answer items', () => {
      render(
        <ChunkCard
          chunkType={ChunkingMode.qa}
          content={{ question: 'What is X?', answer: 'X is Y' }}
          positionId={1}
          wordCount={15}
        />,
      )

      expect(screen.getByTestId('qa-question')).toHaveTextContent('What is X?')
      expect(screen.getByTestId('qa-answer')).toHaveTextContent('X is Y')
    })
  })
})
