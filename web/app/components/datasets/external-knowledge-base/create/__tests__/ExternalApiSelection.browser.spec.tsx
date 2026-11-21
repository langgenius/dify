import type { ExternalKnowledgeApiListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConfigurationModalTestWrapper } from '@/test/configuration-modals-browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ExternalApiSelection from '../ExternalApiSelection'

const mocks = vi.hoisted(() => ({
  getApis: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.get>(),
  create: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.post>(),
  refresh: vi.fn(),
}))
// boundary: Browser Mode has no Next App Router; creation keeps the real modal and query owners.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.externalKnowledgeApi.post': mocks.create,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.externalKnowledgeApi.get': mocks.getApis,
    }),
  }
})

const response: ExternalKnowledgeApiListResponse = {
  data: ['One', 'Two'].map((name, index) => ({
    id: `api-${index + 1}`,
    name: `API ${name}`,
    description: '',
    settings: { endpoint: `https://api${index + 1}.com` },
    created_at: '2026-01-01',
    created_by: 'user',
    tenant_id: 'workspace',
    dataset_bindings: [],
  })),
  has_more: false,
  page: 1,
  limit: 20,
  total: 2,
}

function KnowledgeConnectionForm() {
  const [value, setValue] = useState({ external_knowledge_api_id: '', external_knowledge_id: '' })
  return (
    <>
      <ExternalApiSelection
        {...value}
        onChange={(next) => {
          setValue((current) => ({ ...current, ...next }))
        }}
      />
    </>
  )
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  mocks.getApis.mockReset().mockResolvedValue(response)
  mocks.create.mockReset().mockResolvedValue(response.data[0]!)
})
async function setup() {
  const { wrapper: Providers } = createConfigurationModalTestWrapper()
  return render(
    <Providers>
      <KnowledgeConnectionForm />
      <AppToaster />
    </Providers>,
  )
}

it('defaults to the first API and keeps the chosen API while entering the knowledge ID', async () => {
  const screen = await setup()
  const selector = screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' })
  await expect.element(selector).toHaveTextContent('API One')
  await selector.click()
  await screen.getByRole('button', { name: 'API Two https://api2.com' }).click()
  await expect.element(selector).toHaveTextContent('API Two')
  await expect.element(screen.getByText('https://api2.com')).not.toBeInTheDocument()
  const knowledgeId = screen.getByRole('textbox', { name: 'dataset.externalKnowledgeId' })
  await knowledgeId.fill('kb-123')
  await expect.element(knowledgeId).toHaveValue('kb-123')
  await expect.element(selector).toHaveTextContent('API Two')
})

it.each(['empty list', 'selector'] as const)(
  'refreshes APIs after creation from the %s',
  async (entry) => {
    mocks.getApis.mockResolvedValueOnce({
      ...response,
      data: entry === 'empty list' ? [] : [response.data[1]!],
      total: entry === 'empty list' ? 0 : 1,
    })
    const screen = await setup()
    if (entry === 'selector') {
      await screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }).click()
      await screen.getByRole('button', { name: 'dataset.createNewExternalAPI' }).click()
    } else {
      await screen.getByRole('button', { name: 'dataset.noExternalKnowledge' }).click()
    }
    const dialog = screen.getByRole('dialog', { name: 'dataset.createExternalAPI' })
    await dialog.getByLabelText(/Name/).fill('API One')
    await dialog.getByLabelText(/API Endpoint/).fill('https://api1.com')
    await dialog.getByLabelText(/API Key/).fill('secret-key')
    await dialog.getByRole('button', { name: 'dataset.externalAPIForm.save' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      {
        body: {
          name: 'API One',
          settings: { endpoint: 'https://api1.com', api_key: 'secret-key' },
        },
      },
      { context: { silent: true } },
    )
    const selector = screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' })
    if (entry === 'empty list') await expect.element(selector).toHaveTextContent('API One')
    else {
      await expect.element(selector).toHaveTextContent('API Two')
      await expect
        .element(screen.getByRole('button', { name: 'API One https://api1.com' }))
        .toBeVisible()
    }
  },
)
