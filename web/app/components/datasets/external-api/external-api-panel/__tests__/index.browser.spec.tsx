import type { ExternalKnowledgeApiListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { onlineManager } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { AppToaster } from '@/app/notifications/app-toaster'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { networkError, setupFakeApi } from '@/test/fake-api'
import ExternalAPIPanel from '../index'

const response: ExternalKnowledgeApiListResponse = {
  data: [
    {
      id: '3b8f2c1d-7e4a-4f5b-9c6d-1e2f3a4b5c6d',
      tenant_id: 'tenant-1',
      name: 'Product knowledge',
      description: '',
      settings: { endpoint: 'https://knowledge.example.com', api_key: 'key' },
      dataset_bindings: [],
      created_by: 'user-1',
      created_at: '2021-01-01T00:00:00Z',
    },
  ],
  has_more: false,
  limit: 20,
  page: 1,
  total: 1,
}

const fake = setupFakeApi(() => ({
  console: {
    datasets: {
      externalKnowledgeApi: {
        get: async () => response,
        post: async () => response.data[0]!,
        byExternalKnowledgeApiId: { get: async () => response.data[0]! },
      },
    },
  },
}))

async function setup(canManage = true) {
  const { wrapper: Providers } = createConsoleQueryWrapper({ features: {} })
  const featuresStore = createFeaturesStore()
  function PanelOwner() {
    const [open, setOpen] = useState(true)
    return open ? (
      <ExternalAPIPanel canManageExternalKnowledgeApi={canManage} onClose={() => setOpen(false)} />
    ) : null
  }
  return render(
    <Providers>
      <NuqsTestingAdapter>
        <EventEmitterContextProvider>
          <FeaturesContext value={featuresStore}>
            <>
              {/* RootLayout isolates page z-indices from body-portalled dialogs. */}
              <div className="isolate">
                <PanelOwner />
              </div>
              <AppToaster />
            </>
          </FeaturesContext>
        </EventEmitterContextProvider>
      </NuqsTestingAdapter>
    </Providers>,
  )
}

it('replaces loading with API cards and removes the panel when closed', async () => {
  const pending = createDeferred<ExternalKnowledgeApiListResponse>()
  fake.console.datasets.externalKnowledgeApi.get.mockReturnValue(pending.promise)
  const screen = await setup()
  await expect.element(screen.getByLabelText('common.loading')).toBeVisible()
  pending.resolve(response)
  await expect.element(screen.getByText('Product knowledge')).toBeVisible()
  await expect.element(screen.getByText('https://knowledge.example.com')).toBeVisible()
  await expect.element(screen.getByLabelText('common.loading')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(screen.getByText('dataset.externalAPIPanelTitle')).not.toBeInTheDocument()
  await expect.element(screen.getByText('Product knowledge')).not.toBeInTheDocument()
})

it('shows read-only API cards without management controls', async () => {
  const screen = await setup(false)
  await expect.element(screen.getByText('Product knowledge')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'dataset.createExternalAPI' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /common.operation.edit/ }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /common.operation.delete/ }))
    .not.toBeInTheDocument()
})

it('opens a blank creation form and refreshes the list from the saved API', async () => {
  const refresh = createDeferred<ExternalKnowledgeApiListResponse>()
  let saved: ExternalKnowledgeApiListResponse['data'] = []
  fake.use({
    console: {
      datasets: {
        externalKnowledgeApi: {
          get: async () => ({ ...response, data: saved, total: saved.length }),
          post: async ({ body }) => {
            const created = { ...response.data[0]!, ...body }
            saved = [created]
            fake.console.datasets.externalKnowledgeApi.get.mockReturnValue(refresh.promise)
            return created
          },
        },
      },
    },
  })
  const screen = await setup()
  await screen.getByRole('button', { name: 'dataset.createExternalAPI' }).click()
  const dialog = screen.getByRole('dialog', { name: 'dataset.createExternalAPI' })
  const name = dialog.getByLabelText(/Name/)
  const endpoint = dialog.getByLabelText(/API Endpoint/)
  const key = dialog.getByLabelText(/API Key/)
  await expect.element(name).toHaveValue('')
  await expect.element(endpoint).toHaveValue('')
  await expect.element(key).toHaveValue('')
  await name.fill('Product knowledge')
  await endpoint.fill('https://knowledge.example.com')
  await key.fill('secret-key')
  await dialog.getByRole('button', { name: 'dataset.externalAPIForm.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  refresh.resolve({ ...response, data: saved, total: saved.length })
  await expect.element(screen.getByText('Product knowledge')).toBeVisible()
  await expect.element(screen.getByText('https://knowledge.example.com')).toBeVisible()
  expect(fake.console.datasets.externalKnowledgeApi.post).toHaveBeenCalledExactlyOnceWith({
    body: {
      name: 'Product knowledge',
      settings: { endpoint: 'https://knowledge.example.com', api_key: 'secret-key' },
    },
  })
  await expect
    .element(screen.getByRole('button', { name: /common.operation.edit Product knowledge/ }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: /common.operation.delete Product knowledge/ }))
    .toBeVisible()
})

it('opens the card editor as the only top-level dialog', async () => {
  const screen = await setup()
  const edit = screen.getByRole('button', { name: /common.operation.edit Product knowledge/ })
  await edit.click()
  const editor = screen.getByRole('dialog', { name: 'dataset.editExternalAPIFormTitle' })
  await expect.element(editor).toBeVisible()
  await expect.element(editor).not.toHaveAttribute('data-nested')
  await editor.getByRole('button', { name: 'dataset.externalAPIForm.cancel' }).click()
  await expect.element(edit).toHaveFocus()
})

it('retains the external API draft and allows cancel after an offline save fails', async () => {
  fake.console.datasets.externalKnowledgeApi.post.mockRejectedValueOnce(networkError())
  const screen = await setup()
  await screen.getByRole('button', { name: 'dataset.createExternalAPI' }).click()
  const dialog = screen.getByRole('dialog', { name: /dataset\./ })
  const name = dialog.getByLabelText(/Name/)
  await name.fill('Draft')
  await dialog.getByLabelText(/API Endpoint/).fill('https://knowledge.example.com')
  await dialog.getByLabelText(/API Key/).fill('secret-key')
  onlineManager.setOnline(false)
  onTestFinished(() => onlineManager.setOnline(true))
  await dialog.getByRole('button', { name: 'dataset.externalAPIForm.save' }).click()
  await expect.poll(() => fake.console.datasets.externalKnowledgeApi.post.mock.calls.length).toBe(1)
  await expect.element(name).toHaveValue('Draft')
  await dialog.getByRole('button', { name: /cancel/i }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('attempts an offline edit immediately without opening an editor on reconnect', async () => {
  fake.console.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.get.mockRejectedValueOnce(
    networkError(),
  )
  const screen = await setup()
  const edit = screen.getByRole('button', { name: /common.operation.edit Product knowledge/ })
  await expect.element(edit).toBeVisible()
  onlineManager.setOnline(false)
  onTestFinished(() => onlineManager.setOnline(true))
  await edit.click()
  await expect
    .poll(
      () =>
        fake.console.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.get.mock.calls.length,
    )
    .toBe(1)
  await expect.element(screen.getByText('common.api.actionFailed')).toBeVisible()
  onlineManager.setOnline(true)
  await expect.element(screen.getByRole('dialog', { name: /dataset\./ })).not.toBeInTheDocument()
  await edit.click()
  await expect.element(screen.getByRole('dialog', { name: /dataset\./ })).toBeVisible()
})
