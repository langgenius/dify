import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { ApiSecretKeyButton } from '../built-in-access-points/api-secret-key-button'
import { EnvironmentApiKeyButton } from '../deployed-environment-access-points/environment-api-key-button'

const appApiKeys = {
  max_keys: 10,
  data: [
    {
      id: 'key-1',
      token: 'app-alpha-secret-0001',
      type: 'app',
      created_at: 1,
      last_used_at: 1,
      dataset_ids: [],
    },
    {
      id: 'key-2',
      token: 'app-beta-secret-0002',
      type: 'app',
      created_at: 2,
      last_used_at: 2,
      dataset_ids: [],
    },
  ],
}

const render = (ui: ReactElement, seedKeys = true) => {
  const queryClient = createConsoleQueryClient()
  if (seedKeys)
    queryClient.setQueryData(
      consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
        input: { params: { resource_id: 'app-1' } },
      }),
      appApiKeys,
    )
  return renderWithConsoleQuery(ui, { queryClient })
}

const request = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (path: string[]) => {
      request(path)
      if (path.join('.') === 'apps.byResourceId.apiKeys.get') return appApiKeys
      if (path.join('.') === 'enterprise.appDeploy.accessService.listEnvironmentApiKeys')
        return { data: [{ id: 'environment-key', token: 'env-secret-0001', created_at: 1 }] }
      throw new Error(`Unexpected API call: ${path.join('.')}`)
    },
  },
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

    expect(await screen.findByRole('cell', { name: 'app-a...0001' })).toBeVisible()
  })

  it('uses the environment API key count and opens environment-scoped key management', async () => {
    const user = userEvent.setup()
    render(
      <EnvironmentApiKeyButton appId="app-1" environmentId="staging" apiKeyCount={5} canManage />,
    )

    const button = screen.getByRole('button', {
      name: 'appApi.apiKeyModal.apiSecretKey 5',
    })
    expect(button).toBeEnabled()

    await user.click(button)

    expect(await screen.findByRole('cell', { name: 'env-s...0001' })).toBeVisible()
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
    request.mockClear()
    render(<ApiSecretKeyButton appId="app-1" canManage={false} />, false)

    expect(
      screen.getByRole('button', {
        name: 'appApi.apiKeyModal.apiSecretKey 0',
      }),
    ).toBeDisabled()
    expect(request).not.toHaveBeenCalled()
  })
})
