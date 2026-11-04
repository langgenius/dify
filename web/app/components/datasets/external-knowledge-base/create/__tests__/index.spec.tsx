import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import ExternalKnowledgeBaseCreate from '../index'

const { replace, showApiModal } = vi.hoisted(() => ({ replace: vi.fn(), showApiModal: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowExternalKnowledgeAPIModal: showApiModal }),
}))
const apis: ExternalKnowledgeApiResponse[] = ['First', 'Second'].map((name, index) => ({
  id: `api-${index + 1}`,
  tenant_id: 'tenant-1',
  name,
  description: '',
  settings: { endpoint: `https://api${index + 1}.example.com`, api_key: 'secret' },
  dataset_bindings: [],
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
}))
function setup({ loading = false, available = true } = {}) {
  const onConnect = vi.fn()
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({ input: {} }).queryKey,
    {
      data: available ? apis : [],
      has_more: false,
      page: 1,
      limit: 20,
      total: available ? apis.length : 0,
    },
  )
  const view = renderWithConsoleQuery(
    <ExternalKnowledgeBaseCreate loading={loading} onConnect={onConnect} />,
    { queryClient },
  )
  return { ...view, onConnect }
}
const connectButton = () =>
  screen.getByRole('button', { name: 'dataset.externalKnowledgeForm.connect' })
async function fillForm(user: ReturnType<typeof userEvent.setup>, name = 'Knowledge', id = 'kb-1') {
  if (name)
    await user.type(screen.getByRole('textbox', { name: 'dataset.externalKnowledgeName' }), name)
  if (id) await user.type(screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder'), id)
}
beforeEach(() => vi.clearAllMocks())

it('submits the first available API with default retrieval settings and an optional empty description', async () => {
  const user = userEvent.setup()
  const { onConnect } = setup()
  await fillForm(user)
  await user.click(connectButton())
  expect(onConnect).toHaveBeenCalledExactlyOnceWith({
    name: 'Knowledge',
    description: '',
    provider: 'external',
    external_knowledge_id: 'kb-1',
    external_knowledge_api_id: 'api-1',
    external_retrieval_model: { top_k: 4, score_threshold: 0.5, score_threshold_enabled: false },
  })
})

it('submits the selected API and merges changes to all retrieval fields', async () => {
  const user = userEvent.setup()
  const { onConnect } = setup()
  await fillForm(user, 'Custom knowledge', 'remote-id')
  await user.type(
    screen.getByRole('textbox', { name: 'dataset.externalKnowledgeDescription' }),
    'Reference documents',
  )
  await user.click(await screen.findByText('First'))
  await user.click(screen.getByText('Second'))
  await user.click(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }))
  await user.keyboard('{ArrowUp}')
  await user.click(screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }))
  await user.click(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }))
  await user.keyboard('{ArrowUp}')
  await user.click(connectButton())
  expect(onConnect).toHaveBeenCalledExactlyOnceWith({
    name: 'Custom knowledge',
    description: 'Reference documents',
    provider: 'external',
    external_knowledge_id: 'remote-id',
    external_knowledge_api_id: 'api-2',
    external_retrieval_model: { top_k: 5, score_threshold: 0.51, score_threshold_enabled: true },
  })
})

it.each([
  { name: '', id: 'kb-1', available: true },
  { name: '   ', id: 'kb-1', available: true },
  { name: 'Knowledge', id: '', available: true },
  { name: 'Knowledge', id: 'kb-1', available: false },
])('prevents submission with incomplete required fields: %j', async ({ name, id, available }) => {
  const user = userEvent.setup()
  const { onConnect } = setup({ available })
  await fillForm(user, name, id)
  expect(connectButton()).toBeDisabled()
  await user.click(connectButton())
  expect(onConnect).not.toHaveBeenCalled()
})

it('blocks duplicate connections while loading and allows submission after loading ends', async () => {
  const user = userEvent.setup()
  const { onConnect, rerender } = setup({ loading: true })
  await fillForm(user)
  await user.click(connectButton())
  expect(onConnect).not.toHaveBeenCalled()
  rerender(<ExternalKnowledgeBaseCreate loading={false} onConnect={onConnect} />)
  await user.click(connectButton())
  expect(onConnect).toHaveBeenCalledOnce()
})

it('navigates back and links cancel to the dataset list', async () => {
  const user = userEvent.setup()
  const { onConnect } = setup()
  expect(
    screen.getByRole('link', { name: 'dataset.externalKnowledgeForm.cancel' }),
  ).toHaveAttribute('href', '/datasets')
  await user.click(screen.getByRole('button', { name: 'common.operation.back' }))
  expect(replace).toHaveBeenCalledExactlyOnceWith('/datasets')
  expect(onConnect).not.toHaveBeenCalled()
})

it('offers API creation when there are no APIs to connect', async () => {
  const user = userEvent.setup()
  setup({ available: false })
  await user.click(screen.getByRole('button', { name: 'dataset.noExternalKnowledge' }))
  await waitFor(() =>
    expect(showApiModal).toHaveBeenCalledWith(
      expect.objectContaining({
        isEditMode: false,
        payload: { name: '', settings: { endpoint: '', api_key: '' } },
      }),
    ),
  )
})
