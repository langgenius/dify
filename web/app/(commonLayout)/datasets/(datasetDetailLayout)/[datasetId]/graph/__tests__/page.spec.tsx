import { render, screen } from '@testing-library/react'
import GraphPage from '../page'

vi.mock('@/app/components/datasets/graph', () => ({
  default: ({ datasetId }: { datasetId: string }) => <div>knowledge graph {datasetId}</div>,
}))

describe('Dataset knowledge graph route', () => {
  it('should pass dataset id from route params', async () => {
    render(
      await GraphPage({
        params: Promise.resolve({ datasetId: 'dataset-route-id' }),
      }),
    )

    expect(screen.getByText('knowledge graph dataset-route-id')).toBeInTheDocument()
  })
})
