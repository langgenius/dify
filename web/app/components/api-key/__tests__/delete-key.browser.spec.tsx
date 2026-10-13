import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'
import { createTestQueryClient } from '@/test/query-client'
import { ApiKeyModal } from '../api-key-modal'

const api = vi.hoisted(() => ({
  keys: [] as EnvironmentApiKey[],
  deleteKey: vi.fn(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (path: string[], input: unknown) => {
      switch (path.join('.')) {
        case 'enterprise.appDeploy.accessService.listEnvironmentApiKeys':
          return { data: api.keys }
        case 'enterprise.appDeploy.accessService.deleteEnvironmentApiKey':
          return api.deleteKey(input)
        default:
          throw new Error(`Unexpected API call: ${path.join('.')}`)
      }
    },
  },
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ currentWorkspace: { id: 'workspace-1' } }))
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: () => '2026-10-13' }),
}))

it('returns keyboard control to key management after refetch removes the last deletion trigger', async () => {
  // Environment deletion awaits refetch before closing, so the trigger is already gone.
  // Real browser focus and inert handling must leave the parent dialog usable.
  api.keys = [{ id: 'key-1', token: 'env-secret', type: 'api', created_at: 1 }]
  api.deleteKey.mockImplementation(async () => {
    api.keys = []
  })
  const onOpenChange = vi.fn()
  const store = createStore()
  seedRegisteredConsoleStateFixture(store)
  await render(
    <Provider store={store}>
      <QueryClientProvider client={createTestQueryClient()}>
        <ApiKeyModal
          open
          canManage
          scope={{ type: 'environment', appId: 'app-1', environmentId: 'staging' }}
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>
    </Provider>,
  )

  const trigger = page.getByRole('button', { name: 'common.operation.delete env...env-secret' })
  await expect.element(trigger).toBeVisible()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const confirmation = page.getByRole('alertdialog')
  await expect.element(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'common.operation.confirm' }).click()

  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(trigger).not.toBeInTheDocument()
  const createButton = page.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
  await expect.element(createButton).toHaveFocus()
  expect(api.deleteKey).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1', environment_id: 'staging', api_key_id: 'key-1' },
  })
  expect(onOpenChange).not.toHaveBeenCalled()

  await userEvent.keyboard('{Tab}')
  await expect.element(page.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
})
