import { render, screen } from '@testing-library/react'
import AccessConfig from '../page'

vi.mock('@/app/components/datasets/access-config', () => ({
  default: ({ datasetId }: { datasetId: string }) => (
    <div data-testid="dataset-access-config" data-dataset-id={datasetId}>
      dataset access config
      {datasetId}
    </div>
  ),
}))

describe('Dataset access config route', () => {
  // Route rendering resolves the async dataset id params for the client page.
  describe('Rendering', () => {
    it('should pass dataset id from route params', async () => {
      render(
        await AccessConfig({
          params: Promise.resolve({ datasetId: 'dataset-route-id' }),
        }),
      )

      expect(screen.getByTestId('dataset-access-config')).toHaveAttribute(
        'data-dataset-id',
        'dataset-route-id',
      )
    })
  })
})
