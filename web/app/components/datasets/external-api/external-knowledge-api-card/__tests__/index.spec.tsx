import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { useQuery } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  checkUsageExternalAPI,
  deleteExternalAPI,
  fetchExternalAPI,
  updateExternalAPI,
} from '@/service/datasets'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import ExternalKnowledgeAPICard from '../index'

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  fetchExternalAPI: vi.fn(),
  updateExternalAPI: vi.fn(),
  deleteExternalAPI: vi.fn(),
  checkUsageExternalAPI: vi.fn(),
}))
const { getApis } = vi.hoisted(() => ({ getApis: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.externalKnowledgeApi.get': getApis,
    }),
  }
})

const api = {
  id: 'api-123',
  tenant_id: 'tenant-1',
  name: 'Test External API',
  description: 'Test API description',
  settings: { endpoint: 'https://api.example.com/knowledge', api_key: 'secret-key-123' },
  dataset_bindings: [],
  created_by: 'user-1',
  created_at: '2021-01-01T00:00:00Z',
} satisfies ExternalKnowledgeApiResponse
const listResponse = (data: ExternalKnowledgeApiResponse[]) => ({
  data,
  has_more: false,
  page: 1,
  limit: 20,
  total: data.length,
})
const listOptions = consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({ input: {} })
function setup({ apis = [api], canManage = true } = {}) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(listOptions.queryKey, listResponse(apis))
  function ApiCards() {
    const { data } = useQuery(listOptions)
    return data?.data.map((item, index) => (
      <ExternalKnowledgeAPICard
        key={item.id}
        api={item}
        position={index + 1}
        canManageExternalKnowledgeApi={canManage}
      />
    ))
  }
  return renderWithConfigurationModals(<ApiCards />, { queryClient })
}
const edit = () =>
  screen.getByRole('button', {
    name: `common.operation.edit ${api.name} ${api.settings.endpoint} 1`,
  })
const remove = () =>
  screen.getByRole('button', {
    name: `common.operation.delete ${api.name} ${api.settings.endpoint} 1`,
  })

beforeEach(() => {
  vi.mocked(fetchExternalAPI).mockReset().mockResolvedValue(api)
  vi.mocked(updateExternalAPI).mockReset().mockResolvedValue(api)
  vi.mocked(deleteExternalAPI).mockReset().mockResolvedValue({ result: 'success' })
  vi.mocked(checkUsageExternalAPI).mockReset().mockResolvedValue({ is_using: false, count: 0 })
  getApis.mockReset().mockResolvedValue(listResponse([api]))
})

it('targets the correct API when cards have duplicate names and endpoints', async () => {
  const user = userEvent.setup()
  setup({ apis: [api, { ...api, id: 'api-456' }] })
  await user.click(
    screen.getByRole('button', {
      name: `common.operation.delete ${api.name} ${api.settings.endpoint} 2`,
    }),
  )
  expect(checkUsageExternalAPI).toHaveBeenCalledWith({ apiTemplateId: 'api-456' })
  expect(await screen.findByRole('alertdialog')).toBeVisible()
})

it('hides management actions without permission', () => {
  setup({ canManage: false })
  expect(screen.getByText(api.name)).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /common.operation.(edit|delete)/ }),
  ).not.toBeInTheDocument()
})

it('loads API details and bindings into the real edit dialog', async () => {
  const user = userEvent.setup()
  vi.mocked(fetchExternalAPI).mockResolvedValue({
    ...api,
    dataset_bindings: [{ id: 'ds-1', name: 'Dataset 1' }],
  })
  setup()
  await user.click(edit())
  const dialog = await screen.findByRole('dialog', { name: 'dataset.editExternalAPIFormTitle' })
  expect(fetchExternalAPI).toHaveBeenCalledWith({ apiTemplateId: api.id })
  expect(within(dialog).getByLabelText(/Name/)).toHaveValue(api.name)
  expect(within(dialog).getByLabelText(/API Endpoint/)).toHaveValue(api.settings.endpoint)
  expect(within(dialog).getByLabelText(/API Key/)).toHaveValue(api.settings.api_key)
  expect(dialog).toHaveTextContent('1 dataset.editExternalAPIFormWarning.end')
})

it('saves edits through the modal and refreshes the displayed card', async () => {
  const user = userEvent.setup()
  const updated = {
    ...api,
    name: 'Updated External API',
    settings: { endpoint: 'https://updated.example.com/knowledge', api_key: 'updated-secret-key' },
  }
  getApis.mockResolvedValue(listResponse([updated]))
  setup()
  await user.click(edit())
  const dialog = await screen.findByRole('dialog', { name: 'dataset.editExternalAPIFormTitle' })
  for (const [label, value] of [
    [/Name/, updated.name],
    [/API Endpoint/, updated.settings.endpoint],
    [/API Key/, updated.settings.api_key],
  ] as const) {
    await user.clear(within(dialog).getByLabelText(label))
    await user.type(within(dialog).getByLabelText(label), value)
  }
  await user.click(within(dialog).getByRole('button', { name: 'dataset.externalAPIForm.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(updateExternalAPI).toHaveBeenCalledWith({
    apiTemplateId: api.id,
    body: { name: updated.name, settings: updated.settings },
  })
  expect(await screen.findByText(updated.name)).toBeVisible()
  expect(screen.getByText(updated.settings.endpoint)).toBeVisible()
  expect(screen.queryByText(api.name)).not.toBeInTheDocument()
})

it('shows the usage count before deleting a connected API', async () => {
  const user = userEvent.setup()
  vi.mocked(checkUsageExternalAPI).mockResolvedValue({ is_using: true, count: 3 })
  setup()
  await user.click(remove())
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('3')
  expect(deleteExternalAPI).not.toHaveBeenCalled()
})

it('deletes a confirmed API and removes its card after refreshing the list', async () => {
  const user = userEvent.setup()
  getApis.mockResolvedValue(listResponse([]))
  setup()
  await user.click(remove())
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.confirm',
    }),
  )
  await waitFor(() => expect(screen.queryByText(api.name)).not.toBeInTheDocument())
  expect(deleteExternalAPI).toHaveBeenCalledWith({ apiTemplateId: api.id })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

it('cancels deletion without changing the list', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(remove())
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.cancel',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(screen.getByText(api.name)).toBeVisible()
  expect(deleteExternalAPI).not.toHaveBeenCalled()
  expect(getApis).not.toHaveBeenCalled()
})

it.each(['fetch', 'usage', 'delete'] as const)(
  'preserves the card when the %s request fails',
  async (operation) => {
    const user = userEvent.setup()
    const failure = new Error('Request failed')
    const service =
      operation === 'fetch'
        ? fetchExternalAPI
        : operation === 'usage'
          ? checkUsageExternalAPI
          : deleteExternalAPI
    const request = createDeferred<never>()
    vi.mocked(service).mockReturnValueOnce(request.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      setup()
      await user.click(operation === 'fetch' ? edit() : remove())
      if (operation === 'delete')
        await user.click(
          within(await screen.findByRole('alertdialog')).getByRole('button', {
            name: 'common.operation.confirm',
          }),
        )
      await act(async () => request.reject(failure))
      expect(screen.getByText(api.name)).toBeVisible()
      expect(getApis).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      if (operation !== 'delete') expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  },
)
