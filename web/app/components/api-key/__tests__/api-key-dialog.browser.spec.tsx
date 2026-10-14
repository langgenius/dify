import type { ApiKeyItem } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ApiKeyDialog } from '../api-key-dialog'

const api = vi.hoisted(() => ({ keys: [] as ApiKeyItem[] }))
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (path: string[]) => {
      switch (path.join('.')) {
        case 'apps.byResourceId.apiKeys.get':
          return { data: [...api.keys] }
        case 'apps.byResourceId.apiKeys.post': {
          const key = { id: 'new-key', token: 'app-secret-0009', type: 'app', created_at: 1 }
          api.keys = [...api.keys, key]
          return key
        }
        case 'apps.byResourceId.apiKeys.byApiKeyId.delete':
          api.keys = api.keys.slice(1)
          return undefined
        case 'datasets.apiKeys.get':
          return { data: [] }
        case 'datasets.apiKeys.post':
          return { id: 'dataset-key', token: 'dataset-secret', type: 'dataset' }
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
vi.mock('@/service/knowledge/use-dataset', () => ({
  useInfiniteDatasets: () => ({ data: { pages: [] } }),
}))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => '2026-10-14' }) }))

function Management({
  scope = { type: 'app', appId: 'app-1' },
}: {
  scope?: ComponentProps<typeof ApiKeyDialog>['scope']
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Manage keys
      </button>
      <ApiKeyDialog open={open} onOpenChange={setOpen} canManage scope={scope} />
    </>
  )
}

afterEach(() => vi.unstubAllGlobals())

it('preserves both secret and table during exit and returns focus after creating the tenth key', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  api.keys = Array.from({ length: 9 }, (_, index) => ({
    id: `key-${index}`,
    token: `app-secret-000${index}`,
    type: 'app',
    created_at: 1,
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const screen = await render(
    <QueryClientProvider client={client}>
      <Management />
    </QueryClientProvider>,
  )
  const opener = screen.getByRole('button', { name: 'Manage keys' })
  await opener.click()
  const manager = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' })
  const create = manager.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
  await create.click()
  const result = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.createdTitle' })
  const secret = result.getByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' })
  await expect.element(secret).toHaveValue('app-secret-0009')
  await expect.element(result.getByRole('button', { name: 'common.operation.copy' })).toHaveFocus()
  const resultPopup = result.element()
  const secretInput = secret.element() as HTMLInputElement
  await expect.poll(() => getComputedStyle(resultPopup).opacity).toBe('1')
  const secretExit = new Promise<{ value: string; opacity: number }>((resolve) => {
    resultPopup.addEventListener('transitionrun', function onTransition(event) {
      if (event.target !== resultPopup || (event as TransitionEvent).propertyName !== 'opacity')
        return
      resultPopup.removeEventListener('transitionrun', onTransition)
      resolve({ value: secretInput.value, opacity: Number(getComputedStyle(resultPopup).opacity) })
    })
  })
  await result.getByRole('button', { name: 'common.operation.close' }).last().click()
  const closingSecret = await secretExit
  expect(closingSecret.value).toBe('app-secret-0009')
  expect(closingSecret.opacity).toBeGreaterThan(0)
  await expect.element(result).not.toBeInTheDocument()
  await expect.element(create).toHaveAttribute('aria-disabled', 'true')
  await expect.element(create).toHaveFocus()
  await expect.element(create).toHaveAccessibleDescription(/appApi.apiKeyModal.keyLimitReached/)

  await manager.getByRole('button', { name: 'common.operation.delete app-s...0000' }).click()
  const confirmation = screen.getByRole('alertdialog', {
    name: 'appApi.actionMsg.deleteConfirmTitle',
  })
  await confirmation.getByRole('button', { name: 'common.operation.delete', exact: true }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(create).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(create).toHaveFocus()
  const nextDelete = manager.getByRole('button', { name: 'common.operation.delete app-s...0001' })
  await nextDelete.click()
  await confirmation.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(nextDelete).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.poll(() => manager.element().contains(document.activeElement)).toBe(true)

  const popup = manager.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const tableExit = new Promise<{ text: string | null; opacity: number }>((resolve) => {
    popup.addEventListener('transitionrun', function onTransition(event) {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve({ text: popup.textContent, opacity: Number(getComputedStyle(popup).opacity) })
    })
  })
  await manager.getByRole('button', { name: 'common.operation.close' }).click()
  const closingTable = await tableExit
  expect(closingTable.text).toContain('app-s...0009')
  expect(closingTable.opacity).toBeGreaterThan(0)
  await expect.element(manager).not.toBeInTheDocument()
  await expect.element(opener).toHaveFocus()
  await opener.click()
  await expect.element(manager.getByRole('table')).toBeVisible()
  await expect.element(result).not.toBeInTheDocument()
})

it('hands focus from the knowledge scope picker to the created key and restores it on a later cancellation', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientProvider client={client}>
      <Management scope={{ type: 'dataset' }} />
    </QueryClientProvider>,
  )
  await screen.getByRole('button', { name: 'Manage keys' }).click()
  const create = screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' })
  await create.click()
  const scope = screen.getByRole('dialog', { name: 'appApi.apiKeyModal.addTitle' })
  await scope.getByRole('button', { name: 'common.operation.create' }).click()
  const result = screen.getByRole('alertdialog', { name: 'appApi.apiKeyModal.createdTitle' })
  const secret = result.getByRole('textbox', { name: 'appApi.apiKeyModal.secretKey' })
  await expect.element(secret).toHaveValue('dataset-secret')
  await expect.element(scope).not.toBeInTheDocument()
  await expect.element(result.getByRole('button', { name: 'common.operation.copy' })).toHaveFocus()
  await result.getByRole('button', { name: 'appApi.apiKeyModal.saved' }).click()
  await expect.element(result).not.toBeInTheDocument()
  await expect.element(create).toHaveFocus()
  await create.click()
  await scope.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(scope).not.toBeInTheDocument()
  await expect.element(create).toHaveFocus()
})
