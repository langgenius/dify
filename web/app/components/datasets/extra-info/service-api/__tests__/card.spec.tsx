import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Card from '../card'

vi.mock('@langgenius/dify-ui/popover', () => ({
  PopoverClose: ({ render }: { render: React.ReactNode }) => render,
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('Service API card', () => {
  it('shows the service endpoint and API reference', () => {
    render(
      <Card
        apiBaseUrl="https://api.example.com"
        canManageSecretKey
        onOpenSecretKeyModal={vi.fn()}
      />,
    )

    expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'dataset.serviceApi.card.apiReference' }),
    ).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
  })

  it('opens secret-key management when allowed', async () => {
    const user = userEvent.setup()
    const onOpenSecretKeyModal = vi.fn()
    render(
      <Card
        apiBaseUrl="https://api.example.com"
        canManageSecretKey
        onOpenSecretKeyModal={onOpenSecretKeyModal}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    expect(onOpenSecretKeyModal).toHaveBeenCalledOnce()
  })

  it('disables secret-key management when it is not allowed', () => {
    render(<Card apiBaseUrl="https://api.example.com" onOpenSecretKeyModal={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' })).toBeDisabled()
  })
})
