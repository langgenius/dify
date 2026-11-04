import type { ExternalKnowledgeApiListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createExternalAPI } from '@/service/datasets'
import { renderWithConfigurationModals as render } from '@/test/configuration-modals'
import ExternalApiSelection from '../ExternalApiSelection'

const mocks = vi.hoisted(() => ({ getApis: vi.fn(), refresh: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  createExternalAPI: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
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

function Harness() {
  const [value, setValue] = useState({ external_knowledge_api_id: '', external_knowledge_id: '' })
  return (
    <>
      <ExternalApiSelection
        {...value}
        onChange={(next) => {
          setValue((current) => ({ ...current, ...next }))
        }}
      />
      <output aria-label="Knowledge connection">{JSON.stringify(value)}</output>
    </>
  )
}

beforeEach(() => {
  mocks.getApis.mockResolvedValue(response)
  vi.mocked(createExternalAPI).mockResolvedValue(response.data[0]!)
})

it('defaults to the first API and keeps the chosen API while entering the knowledge ID', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const selector = await screen.findByRole('button', { name: 'dataset.externalAPIPanelTitle' })
  await waitFor(() => expect(selector).toHaveTextContent('API One'))
  await user.click(selector)
  await user.click(screen.getByRole('button', { name: 'API Two https://api2.com' }))
  expect(selector).toHaveTextContent('API Two')
  expect(screen.queryByText('https://api2.com')).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'dataset.externalKnowledgeId' }), 'kb-123')
  expect(JSON.parse(screen.getByLabelText('Knowledge connection').textContent!)).toEqual({
    external_knowledge_api_id: 'api-2',
    external_knowledge_id: 'kb-123',
  })
})

it.each(['empty list', 'selector'] as const)(
  'refreshes APIs after creation from the %s',
  async (entry) => {
    const user = userEvent.setup()
    mocks.getApis.mockResolvedValueOnce({
      ...response,
      data: entry === 'empty list' ? [] : [response.data[1]!],
      total: entry === 'empty list' ? 0 : 1,
    })
    render(<Harness />)
    if (entry === 'selector') {
      await user.click(await screen.findByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
      await user.click(screen.getByRole('button', { name: 'dataset.createNewExternalAPI' }))
    } else {
      await user.click(await screen.findByRole('button', { name: 'dataset.noExternalKnowledge' }))
    }
    const dialog = await screen.findByRole('dialog', { name: 'dataset.createExternalAPI' })
    await user.type(within(dialog).getByLabelText(/Name/), 'API One')
    await user.type(within(dialog).getByLabelText(/API Endpoint/), 'https://api1.com')
    await user.type(within(dialog).getByLabelText(/API Key/), 'secret-key')
    await user.click(within(dialog).getByRole('button', { name: 'dataset.externalAPIForm.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(createExternalAPI).toHaveBeenCalledWith({
      body: { name: 'API One', settings: { endpoint: 'https://api1.com', api_key: 'secret-key' } },
    })
    await waitFor(() => expect(mocks.getApis).toHaveBeenCalledTimes(2))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    const selector = screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' })
    if (entry === 'empty list') await waitFor(() => expect(selector).toHaveTextContent('API One'))
    else {
      expect(selector).toHaveTextContent('API Two')
      expect(await screen.findByRole('button', { name: 'API One https://api1.com' })).toBeVisible()
    }
  },
)
