import { render, screen } from '@testing-library/react'
import { ChunkingMode } from '@/models/datasets'
import ChunkCard from '../chunk-card'

it('shows text, its summary, and its numbered chunk header', () => {
  render(
    <ChunkCard
      chunkType={ChunkingMode.text}
      content={{ content: 'Hello world', summary: 'Overview' }}
      positionId={5}
      wordCount={11}
    />,
  )
  expect(screen.getByText('Hello world')).toBeInTheDocument()
  expect(screen.getByText('Overview')).toBeInTheDocument()
  expect(screen.getByText('Chunk-05')).toBeInTheDocument()
  expect(
    screen.getByText('11 datasetDocuments.segment.characters:{"count":11}'),
  ).toBeInTheDocument()
})

it('shows child slices and a parent summary for paragraph chunks', () => {
  render(
    <ChunkCard
      chunkType={ChunkingMode.parentChild}
      parentMode="paragraph"
      content={{
        parent_content: 'Parent',
        parent_summary: 'Parent overview',
        child_contents: ['First child', 'Second child'],
        parent_mode: 'paragraph',
      }}
      positionId={3}
      wordCount={6}
    />,
  )
  expect(screen.getByText('Parent-Chunk-03')).toBeInTheDocument()
  expect(screen.getByText('First child')).toBeInTheDocument()
  expect(screen.getByText('Second child')).toBeInTheDocument()
  expect(screen.getByText('C-1')).toBeInTheDocument()
  expect(screen.getByText('C-2')).toBeInTheDocument()
  expect(screen.getByText('Parent overview')).toBeInTheDocument()
})

it('shows full-document children without a numbered parent header or an absent summary', () => {
  render(
    <ChunkCard
      chunkType={ChunkingMode.parentChild}
      parentMode="full-doc"
      content={{
        parent_content: 'Document',
        child_contents: ['Full doc child'],
        parent_mode: 'full-doc',
      }}
      positionId={1}
      wordCount={300}
    />,
  )
  expect(screen.getByText('Full doc child')).toBeInTheDocument()
  expect(screen.queryByText(/Chunk-01/)).not.toBeInTheDocument()
  expect(screen.queryByText('datasetDocuments.segment.summary')).not.toBeInTheDocument()
})

it('renders a question and answer as separate parts of a QA chunk', () => {
  render(
    <ChunkCard
      chunkType={ChunkingMode.qa}
      content={{ question: 'What is X?', answer: 'X is Y' }}
      positionId={1}
      wordCount={15}
    />,
  )
  expect(screen.getByText('Q')).toBeInTheDocument()
  expect(screen.getByText('What is X?')).toBeInTheDocument()
  expect(screen.getByText('A')).toBeInTheDocument()
  expect(screen.getByText('X is Y')).toBeInTheDocument()
})
