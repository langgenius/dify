import type { ExternalKnowledgeApiListResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ExternalApiSelection from '../ExternalApiSelection'

const mocks = vi.hoisted(() => ({ getApis: vi.fn(), refresh: vi.fn(), openModal: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowExternalKnowledgeAPIModal: mocks.openModal }),
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

function Harness({ onChange = vi.fn() }: { onChange?: (value: object) => void }) {
  const [value, setValue] = useState({ external_knowledge_api_id: '', external_knowledge_id: '' })
  return (
    <ExternalApiSelection
      {...value}
      onChange={(next) => {
        setValue((current) => ({ ...current, ...next }))
        onChange(next)
      }}
    />
  )
}

beforeEach(() => mocks.getApis.mockResolvedValue(response))

it('defaults to the first API and keeps the chosen API while entering the knowledge ID', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  const selector = await screen.findByRole('button', { name: 'dataset.externalAPIPanelTitle' })
  await waitFor(() => expect(selector).toHaveTextContent('API One'))
  await user.click(selector)
  await user.click(screen.getByRole('button', { name: 'API Two https://api2.com' }))
  expect(selector).toHaveTextContent('API Two')
  expect(screen.queryByText('https://api2.com')).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'dataset.externalKnowledgeId' }), 'kb-123')
  expect(onChange).toHaveBeenLastCalledWith({
    external_knowledge_api_id: 'api-2',
    external_knowledge_id: 'kb-123',
  })
})

it.each(['empty list', 'selector'] as const)(
  'refreshes APIs after creation from the %s',
  async (entry) => {
    const user = userEvent.setup()
    if (entry === 'empty list')
      mocks.getApis.mockResolvedValueOnce({ ...response, data: [], total: 0 })
    render(<Harness />)
    if (entry === 'selector') {
      await user.click(await screen.findByRole('button', { name: 'dataset.externalAPIPanelTitle' }))
      await user.click(screen.getByRole('button', { name: 'dataset.createNewExternalAPI' }))
    } else {
      await user.click(await screen.findByRole('button', { name: 'dataset.noExternalKnowledge' }))
    }
    expect(mocks.openModal).toHaveBeenCalledWith(expect.objectContaining({ isEditMode: false }))
    await act(async () => mocks.openModal.mock.calls[0]![0].onSaveCallback())
    await waitFor(() => expect(mocks.getApis).toHaveBeenCalledTimes(2))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'dataset.externalAPIPanelTitle' }),
      ).toHaveTextContent('API One'),
    )
  },
)
