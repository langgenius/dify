import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { fetchExternalAPI } from '@/service/datasets'
import { createHttpError } from '@/service/http-error'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import ExternalAPIPanel from '../../external-api-panel'

vi.mock('@/service/datasets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/datasets')>()),
  fetchExternalAPI: vi.fn(),
}))
const { getApis, updateExternalAPI, deleteExternalAPI, checkUsageExternalAPI } = vi.hoisted(() => ({
  getApis: vi.fn(),
  updateExternalAPI: vi.fn(),
  deleteExternalAPI: vi.fn(),
  checkUsageExternalAPI: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch': updateExternalAPI,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.externalKnowledgeApi.get': getApis,
      'datasets.externalKnowledgeApi.byExternalKnowledgeApiId.delete': deleteExternalAPI,
      'datasets.externalKnowledgeApi.byExternalKnowledgeApiId.useCheck.get': checkUsageExternalAPI,
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
  return renderWithConfigurationModals(
    <ExternalAPIPanel canManageExternalKnowledgeApi={canManage} onClose={() => {}} />,
    { queryClient },
  )
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
  deleteExternalAPI.mockReset().mockResolvedValue({ result: 'success' })
  checkUsageExternalAPI.mockReset().mockResolvedValue({ is_using: false, count: 0 })
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
  await waitFor(() =>
    expect(checkUsageExternalAPI).toHaveBeenCalledWith({
      params: { external_knowledge_api_id: 'api-456' },
    }),
  )
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
  expect(await within(dialog).findByLabelText(/Name/)).toHaveValue(api.name)
  expect(within(dialog).getByLabelText(/API Endpoint/)).toHaveValue(api.settings.endpoint)
  expect(within(dialog).getByLabelText(/API Key/)).toHaveValue(api.settings.api_key)
  await user.click(
    within(dialog).getByRole('button', { name: 'dataset.editExternalAPITooltipTitle' }),
  )
  const bindings = await screen.findByRole('dialog', {
    name: '1 dataset.editExternalAPITooltipTitle',
  })
  expect(within(bindings).getByRole('listitem')).toHaveTextContent('Dataset 1')
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
    params: { external_knowledge_api_id: api.id },
    body: { name: updated.name, settings: updated.settings },
  })
  expect(await screen.findByText(updated.name)).toBeVisible()
  expect(screen.getByText(updated.settings.endpoint)).toBeVisible()
  expect(screen.queryByText(api.name)).not.toBeInTheDocument()
})

it('shows the usage count before deleting a connected API', async () => {
  const user = userEvent.setup()
  checkUsageExternalAPI.mockResolvedValue({ is_using: true, count: 3 })
  setup()
  await user.click(remove())
  await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('3'))
  expect(deleteExternalAPI).not.toHaveBeenCalled()
})

it('shows the translated error code when the usage check fails', async () => {
  const user = userEvent.setup()
  checkUsageExternalAPI.mockRejectedValue(
    createHttpError(new Response(null, { status: 503 }), {
      code: 'invalid_input',
      message: 'Server says why',
    }),
  )
  setup()
  await user.click(remove())
  await waitFor(() =>
    expect(screen.getByRole('alertdialog')).toHaveTextContent('requestErrors.code.invalid_input'),
  )
  expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
})

it('opens the confirmation while checking usage and ignores a result after Escape', async () => {
  const user = userEvent.setup()
  const usage = createDeferred<{ is_using: boolean; count: number }>()
  checkUsageExternalAPI.mockReturnValueOnce(usage.promise)
  setup()

  await user.click(remove())
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(remove()).toHaveFocus()
  await user.click(edit())
  expect(await screen.findByRole('dialog')).toBeVisible()
  await act(async () => usage.resolve({ is_using: true, count: 3 }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(deleteExternalAPI).not.toHaveBeenCalled()
})

it('does not open an older edit request over the active delete confirmation', async () => {
  const user = userEvent.setup()
  const detail = createDeferred<ExternalKnowledgeApiResponse>()
  vi.mocked(fetchExternalAPI).mockReturnValueOnce(detail.promise)
  setup()
  await user.click(edit())
  expect(fetchExternalAPI).toHaveBeenCalledTimes(1)
  await user.click(remove())
  expect(await screen.findByRole('alertdialog')).toBeVisible()
  await act(async () => detail.resolve(api))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('alertdialog')).toBeVisible()
})

it('removes the deleted API before refreshing and returns focus to the create action', async () => {
  const user = userEvent.setup()
  const refresh = createDeferred<ReturnType<typeof listResponse>>()
  getApis.mockReturnValueOnce(refresh.promise)
  setup()
  await user.click(remove())
  const confirm = within(await screen.findByRole('alertdialog')).getByRole('button', {
    name: 'common.operation.confirm',
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  await user.click(confirm)
  await waitFor(() => expect(screen.queryByText(api.name)).not.toBeInTheDocument())
  expect(deleteExternalAPI).toHaveBeenCalledWith({ params: { external_knowledge_api_id: api.id } })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'dataset.createExternalAPI' })).toHaveFocus(),
  )
  expect(getApis).toHaveBeenCalledTimes(1)
  await act(async () => refresh.resolve(listResponse([])))
})

it('keeps deletion pending in the dialog and prevents duplicate requests', async () => {
  const user = userEvent.setup()
  const request = createDeferred<{ result: string }>()
  deleteExternalAPI.mockReturnValueOnce(request.promise)
  getApis.mockResolvedValue(listResponse([]))
  setup()
  await user.click(remove())
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'common.operation.confirm' })
  const cancel = within(dialog).getByRole('button', { name: 'common.operation.cancel' })

  await waitFor(() => expect(confirm).toBeEnabled())
  await user.click(confirm)
  await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
  expect(confirm).toHaveAttribute('aria-disabled', 'true')
  expect(cancel).toBeDisabled()
  expect(deleteExternalAPI).toHaveBeenCalledTimes(1)

  await user.click(confirm)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeVisible()
  expect(deleteExternalAPI).toHaveBeenCalledTimes(1)

  await act(async () => request.resolve({ result: 'success' }))
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText(api.name)).not.toBeInTheDocument()
  })
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
    const wasOnline = onlineManager.isOnline()
    try {
      setup()
      if (operation === 'usage') onlineManager.setOnline(false)
      await user.click(operation === 'fetch' ? edit() : remove())
      if (operation === 'usage')
        await waitFor(() => expect(checkUsageExternalAPI).toHaveBeenCalledTimes(1))
      if (operation === 'delete') {
        const confirm = within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'common.operation.confirm',
        })
        await waitFor(() => expect(confirm).toBeEnabled())
        onlineManager.setOnline(false)
        await user.click(confirm)
        expect(deleteExternalAPI).toHaveBeenCalledExactlyOnceWith({
          params: { external_knowledge_api_id: api.id },
        })
      }
      await act(async () => request.reject(failure))
      onlineManager.setOnline(wasOnline)
      expect(screen.getByText(api.name)).toBeVisible()
      expect(getApis).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      if (operation === 'fetch') expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      else expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      if (operation === 'usage') {
        expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
        await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeEnabled(),
        )
      }
      if (operation === 'delete') {
        expect(await screen.findByRole('alert')).toHaveTextContent('Request failed')
        const confirm = screen.getByRole('button', { name: 'common.operation.confirm' })
        expect(confirm).not.toHaveAttribute('aria-disabled', 'true')
        getApis.mockResolvedValue(listResponse([]))
        await user.click(confirm)
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(deleteExternalAPI).toHaveBeenCalledTimes(2)
      }
    } finally {
      onlineManager.setOnline(wasOnline)
      consoleError.mockRestore()
    }
  },
)

it('edits only the last selected card when detail requests resolve out of order', async () => {
  const user = userEvent.setup()
  const first = createDeferred<ExternalKnowledgeApiResponse>()
  const second = { ...api, id: 'second', name: 'Second API' }
  vi.mocked(fetchExternalAPI).mockReturnValueOnce(first.promise).mockResolvedValueOnce(second)
  setup({ apis: [api, second] })
  await user.click(edit())
  await user.click(screen.getByRole('button', { name: /common.operation.edit Second API/ }))
  const editor = await screen.findByRole('dialog', { name: 'dataset.editExternalAPIFormTitle' })
  await act(async () => first.resolve(api))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(within(editor).getByLabelText(/Name/)).toHaveValue('Second API')
})
