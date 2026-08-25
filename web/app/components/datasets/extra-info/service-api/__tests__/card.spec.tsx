import { Popover } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServiceApiCard } from '../card'

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('Service API card', () => {
  const renderCard = (props: React.ComponentProps<typeof ServiceApiCard>) =>
    render(
      <Popover>
        <ServiceApiCard {...props} />
      </Popover>,
    )

  it('shows the service endpoint and API reference', () => {
    renderCard({
      apiBaseUrl: 'https://api.example.com',
      canManageApiKey: true,
      onOpenApiKeyModal: vi.fn(),
    })

    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.serviceApi.card.apiReference' }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
  })

  it('opens secret-key management when allowed', async () => {
    const user = userEvent.setup()
    const onOpenApiKeyModal = vi.fn()
    renderCard({
      apiBaseUrl: 'https://api.example.com',
      canManageApiKey: true,
      onOpenApiKeyModal,
    })

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    expect(onOpenApiKeyModal).toHaveBeenCalledOnce()
  })

  it('disables secret-key management when it is not allowed', () => {
    renderCard({
      apiBaseUrl: 'https://api.example.com',
      canManageApiKey: false,
      onOpenApiKeyModal: vi.fn(),
    })

    expect(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' })).toBeDisabled()
  })
})
