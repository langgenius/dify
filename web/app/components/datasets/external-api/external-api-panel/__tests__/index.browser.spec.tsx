import type { ExternalKnowledgeApiListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ExternalAPIPanel from '../index'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.get>(),
  create: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.externalKnowledgeApi.get': api.list,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.externalKnowledgeApi.post': api.create,
    }),
  }
})

const response: ExternalKnowledgeApiListResponse = {
  data: [
    {
      id: 'api-1',
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

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.list.mockReset().mockResolvedValue(response)
  api.create.mockReset().mockResolvedValue(response.data[0]!)
})

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
            <ModalContextProvider>
              {/* RootLayout isolates page z-indices from body-portalled dialogs. */}
              <div className="isolate">
                <PanelOwner />
              </div>
            </ModalContextProvider>
          </FeaturesContext>
        </EventEmitterContextProvider>
      </NuqsTestingAdapter>
    </Providers>,
  )
}

it('replaces loading with API cards and removes the panel when closed', async () => {
  const pending = createDeferred<ExternalKnowledgeApiListResponse>()
  api.list.mockReturnValue(pending.promise)
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
  let saved: ExternalKnowledgeApiListResponse['data'] = []
  api.list.mockImplementation(async () => ({ ...response, data: saved, total: saved.length }))
  api.create.mockImplementation(async ({ body }) => {
    const created = { ...response.data[0]!, ...body }
    saved = [created]
    return created
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
  await expect.element(screen.getByText('Product knowledge')).toBeVisible()
  await expect.element(screen.getByText('https://knowledge.example.com')).toBeVisible()
  expect(api.create).toHaveBeenCalledExactlyOnceWith(
    {
      body: {
        name: 'Product knowledge',
        settings: { endpoint: 'https://knowledge.example.com', api_key: 'secret-key' },
      },
    },
    { context: { silent: true } },
  )
  await expect
    .element(screen.getByRole('button', { name: /common.operation.edit Product knowledge/ }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: /common.operation.delete Product knowledge/ }))
    .toBeVisible()
})
