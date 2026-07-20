import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ServiceApi from '../index'

let mockPermissionKeys = ['dataset.api_key.manage']

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>()
  return {
    ...actual,
    useAtomValue: () => mockPermissionKeys,
  }
})

vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow }: { isShow: boolean }) => (isShow ? <div>secret key modal</div> : null),
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

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.title' }))
    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    expect(screen.getByText('secret key modal')).toBeInTheDocument()
  })

  it('prevents secret-key management without workspace permission', async () => {
    const user = userEvent.setup()
    mockPermissionKeys = []
    render(<ServiceApi apiBaseUrl="https://api.example.com" />)

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.title' }))

    expect(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' })).toBeDisabled()
    expect(screen.queryByText('secret key modal')).not.toBeInTheDocument()
  })
})
