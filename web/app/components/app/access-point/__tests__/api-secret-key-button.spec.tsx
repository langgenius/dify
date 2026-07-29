import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { ApiSecretKeyButton } from '../api-secret-key-button'

const mocks = vi.hoisted(() => ({
  apiKeysQuery: {
    data: {
      data: [
        { id: 'key-1', token: 'app-a', created_at: '1', last_used_at: '1' },
        { id: 'key-2', token: 'app-b', created_at: '2', last_used_at: '2' },
      ],
    },
    isError: false,
    isPending: false,
  },
}))

vi.mock('@/service/use-apps', () => ({
  useAppApiKeys: () => mocks.apiKeysQuery,
}))

vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({
    appId,
    canManage,
    isShow,
  }: {
    appId?: string
    canManage: boolean
    isShow: boolean
  }) =>
    isShow ? (
      <div role="dialog" aria-label="API key management">
        {appId}:{String(canManage)}
      </div>
    ) : null,
}))

describe('ApiSecretKeyButton', () => {
  it('shows the current API key count and opens key management', async () => {
    const user = userEvent.setup()
    render(<ApiSecretKeyButton appId="app-1" canManage />)

    const button = screen.getByRole('button', {
      name: 'appApi.apiKeyModal.apiSecretKey 2',
    })
    expect(button).toBeEnabled()

    await user.click(button)

    expect(screen.getByRole('dialog', { name: 'API key management' })).toHaveTextContent(
      'app-1:true',
    )
  })

  it('keeps the current count visible when service access is disabled', () => {
    render(<ApiSecretKeyButton appId="app-1" canManage disabled />)

    expect(
      screen.getByRole('button', {
        name: 'appApi.apiKeyModal.apiSecretKey 2',
      }),
    ).toBeDisabled()
  })

  it('keeps the current count visible without management permission', () => {
    render(<ApiSecretKeyButton appId="app-1" canManage={false} />)

    expect(
      screen.getByRole('button', {
        name: 'appApi.apiKeyModal.apiSecretKey 2',
      }),
    ).toBeDisabled()
  })
})
