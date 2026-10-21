import { render, screen } from '@testing-library/react'
import { VectorIndexStatus } from '../vector-index-status'

it('shows rebuild progress and the current failure until the target recovers', () => {
  const { rerender } = render(
    <VectorIndexStatus dataset={{ vector_indexing_status: 'indexing' }} />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('datasetDocuments.list.status.indexing')

  rerender(
    <VectorIndexStatus
      dataset={{
        vector_indexing_status: 'error',
        vector_indexing_error: 'Embedding provider unavailable',
      }}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('Embedding provider unavailable')

  rerender(<VectorIndexStatus dataset={{ vector_indexing_status: 'completed' }} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
