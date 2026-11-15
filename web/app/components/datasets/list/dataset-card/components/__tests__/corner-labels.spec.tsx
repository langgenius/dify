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
