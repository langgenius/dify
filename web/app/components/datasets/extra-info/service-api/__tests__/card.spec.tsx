import { Dialog } from '@langgenius/dify-ui/dialog'
import { Popover } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import { ServiceApiCard } from '../card'

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('Service API card', () => {
  const renderCard = (props: React.ComponentProps<typeof ServiceApiCard>) =>
    render(
      <Dialog>
        <Popover>
          <ServiceApiCard {...props} />
        </Popover>
      </Dialog>,
    )

  it('shows the service endpoint and API reference', () => {
    renderCard({
      apiBaseUrl: 'https://api.example.com',
      canManageApiKey: true,
    })

    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.serviceApi.card.apiReference' }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
  })

  it('disables secret-key management when it is not allowed', () => {
    renderCard({
      apiBaseUrl: 'https://api.example.com',
      canManageApiKey: false,
    })

    expect(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' })).toBeDisabled()
  })
})
