import { render, screen } from '@testing-library/react'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import CornerLabels from '../corner-labels'

it.each([true, false])(
  'reports unavailable embeddings only when embedding_available=%s is false',
  (embeddingAvailable) => {
    render(
      <CornerLabels dataset={createDatasetFixture({ embedding_available: embeddingAvailable })} />,
    )
    expect(!!screen.queryByText('dataset.cornerLabel.unavailable')).toBe(!embeddingAvailable)
  },
)

it('reports a missing reranking dependency and clears the label when it recovers', () => {
  const dataset = createDatasetFixture({ reranking_available: false })
  const { rerender } = render(<CornerLabels dataset={dataset} />)
  expect(screen.getByText('dataset.cornerLabel.unavailable')).toBeInTheDocument()
  rerender(<CornerLabels dataset={{ ...dataset, reranking_available: true }} />)
  expect(screen.queryByText('dataset.cornerLabel.unavailable')).not.toBeInTheDocument()
})
