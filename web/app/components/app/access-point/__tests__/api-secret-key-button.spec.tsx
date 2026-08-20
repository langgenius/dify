import type { ApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/client'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { ApiSecretKeyButton } from '../shared/api-secret-key-button'

const appApiKeys: ApiKeyList = {
  data: [
    { id: 'key-1', token: 'app-a', type: 'app', created_at: 1, last_used_at: 1 },
    { id: 'key-2', token: 'app-b', type: 'app', created_at: 2, last_used_at: 2 },
  ],
}

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
      input: { params: { resource_id: 'app-1' } },
    }),
    appApiKeys,
  )
  return renderWithConsoleQuery(ui, { queryClient })
}

vi.mock('@/app/components/api-key/api-key-modal', () => ({
  ApiKeyModal: ({
    canManage,
    open,
    scope,
  }: {
    canManage: boolean
    open: boolean
    scope:
      | { type: 'app'; appId: string }
      | { type: 'dataset' }
      | { type: 'environment'; appId: string; environmentId: string }
  }) =>
    open ? (
      <div role="dialog" aria-label="API key management">
        {scope.type === 'dataset' ? '' : scope.appId}:
        {scope.type === 'environment' ? scope.environmentId : ''}:{String(canManage)}
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

  it('does not request API keys without management permission', () => {
    render(<ApiSecretKeyButton appId="app-1" canManage={false} />)

    expect(
      screen.getByRole('button', {
        name: 'appApi.apiKeyModal.apiSecretKey 0',
      }),
    ).toBeDisabled()
  })
})
