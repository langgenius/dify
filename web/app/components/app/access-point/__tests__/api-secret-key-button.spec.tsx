import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { ApiSecretKeyButton } from '../api-secret-key-button'

const mocks = vi.hoisted(() => ({
  appApiKeysArgs: [] as unknown[][],
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
  useAppApiKeys: (...args: unknown[]) => {
    mocks.appApiKeysArgs.push(args)
    return mocks.apiKeysQuery
  },
}))

vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({
    appId,
    canManage,
    environmentId,
    isShow,
  }: {
    appId?: string
    canManage: boolean
    environmentId?: string
    isShow: boolean
  }) =>
    isShow ? (
      <div role="dialog" aria-label="API key management">
        {appId}:{environmentId}:{String(canManage)}
      </div>
    ) : null,
}))

describe('ApiSecretKeyButton', () => {
  beforeEach(() => {
    mocks.appApiKeysArgs.length = 0
  })

  it('shows the current API key count and opens key management', async () => {
    const user = userEvent.setup()
    render(<ApiSecretKeyButton appId="app-1" canManage />)

    const button = screen.getByRole('button', {
      name: 'appApi.apiKeyModal.apiSecretKey 2',
    })
    expect(button).toBeEnabled()

    await user.click(button)

    expect(screen.getByRole('dialog', { name: 'API key management' })).toHaveTextContent(
      'app-1::true',
    )
  })

  it('uses the environment API key count and opens environment-scoped key management', async () => {
    const user = userEvent.setup()
    render(<ApiSecretKeyButton appId="app-1" environmentId="staging" apiKeyCount={5} canManage />)

    const button = screen.getByRole('button', {
      name: 'appApi.apiKeyModal.apiSecretKey 5',
    })
    expect(button).toBeEnabled()
    expect(mocks.appApiKeysArgs[0]?.[0]).toBeUndefined()

    await user.click(button)

    expect(screen.getByRole('dialog', { name: 'API key management' })).toHaveTextContent(
      'app-1:staging:true',
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
