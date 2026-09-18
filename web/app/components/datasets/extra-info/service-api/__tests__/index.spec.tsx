import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { ServiceApi } from '../index'

let mockPermissionKeys = ['dataset.api_key.manage']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockPermissionKeys,
  }))
})

vi.mock('@/app/components/api-key/api-key-modal', () => ({
  ApiKeyModal: ({ open }: { open: boolean }) => (open ? <div>API key modal</div> : null),
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('ServiceApi', () => {
  beforeEach(() => {
    mockPermissionKeys = ['dataset.api_key.manage']
  })

  it('opens secret-key management from the service API details', async () => {
    const user = userEvent.setup()
    render(<ServiceApi apiBaseUrl="https://api.example.com" />)

    const trigger = screen.getByRole('button', { name: 'dataset.serviceApi.title' })
    expect(trigger).not.toHaveAttribute('data-popup-open')

    await user.click(trigger)

    expect(trigger).toHaveAttribute('data-popup-open', '')
    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    expect(screen.getByText('API key modal')).toBeInTheDocument()
  })

  it('prevents secret-key management without workspace permission', async () => {
    const user = userEvent.setup()
    mockPermissionKeys = []
    render(<ServiceApi apiBaseUrl="https://api.example.com" />)

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.title' }))

    expect(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' })).toBeDisabled()
    expect(screen.queryByText('API key modal')).not.toBeInTheDocument()
  })
})
