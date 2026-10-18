import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createExternalAPI } from '@/service/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AddExternalAPIModal from '../index'

vi.mock('@/service/datasets', () => ({ createExternalAPI: vi.fn() }))
const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { error, success: vi.fn() } }))
const data = {
  name: 'Product API',
  settings: { endpoint: 'https://api.example.com', api_key: 'secret-key' },
}
const response: ExternalKnowledgeApiResponse = {
  ...data,
  id: 'api-1',
  tenant_id: 'tenant-1',
  description: '',
  dataset_bindings: [],
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
}
const props = { onSave: vi.fn(), onCancel: vi.fn(), isEditMode: false }
const save = () => screen.getByRole('button', { name: 'dataset.externalAPIForm.save' })
async function fill(user: ReturnType<typeof userEvent.setup>, apiKey = data.settings.api_key) {
  await user.type(screen.getByLabelText(/Name/), data.name)
  await user.type(screen.getByLabelText(/API Endpoint/), data.settings.endpoint)
  await user.type(screen.getByLabelText(/API Key/), apiKey)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createExternalAPI).mockReset().mockResolvedValue(response)
})

it('creates an API with entered settings and returns the saved record before closing', async () => {
  const user = userEvent.setup()
  render(<AddExternalAPIModal {...props} />)
  expect(save()).toBeDisabled()
  await fill(user)
  await user.click(save())
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(response))
  expect(createExternalAPI).toHaveBeenCalledWith({ body: data })
  expect(props.onCancel).toHaveBeenCalledOnce()
})

it('rejects short API keys without sending a request', async () => {
  const user = userEvent.setup()
  render(<AddExternalAPIModal {...props} />)
  await fill(user, 'key')
  await user.click(save())
  expect(error).toHaveBeenCalledWith('common.apiBasedExtension.modal.apiKey.lengthError')
  expect(createExternalAPI).not.toHaveBeenCalled()
  expect(props.onCancel).not.toHaveBeenCalled()
})

it('preserves entered settings for retry when creation fails', async () => {
  const user = userEvent.setup()
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(createExternalAPI)
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(response)
  render(<AddExternalAPIModal {...props} />)
  await fill(user)
  await user.click(save())
  await waitFor(() => expect(error).toHaveBeenCalledWith('Failed to save/update External API'))
  expect(props.onCancel).not.toHaveBeenCalled()
  expect(screen.getByLabelText(/API Endpoint/)).toHaveValue(data.settings.endpoint)
  await user.click(save())
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(response))
  consoleError.mockRestore()
})

it('saves an unbound API through the edit callback with the updated fields', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn().mockResolvedValue(undefined)
  render(<AddExternalAPIModal {...props} isEditMode data={data} onEdit={onEdit} />)
  await user.type(screen.getByLabelText(/Name/), ' updated')
  await user.click(save())
  expect(onEdit).toHaveBeenCalledWith({ ...data, name: 'Product API updated' })
  expect(createExternalAPI).not.toHaveBeenCalled()
})

it('requires confirmation before changing an API used by a dataset and allows backing out', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn().mockResolvedValue(undefined)
  render(
    <AddExternalAPIModal
      {...props}
      isEditMode
      data={data}
      onEdit={onEdit}
      datasetBindings={[{ id: 'ds-1', name: 'Guide' }]}
    />,
  )
  await user.click(save())
  let dialog = await screen.findByRole('alertdialog')
  expect(onEdit).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  expect(onEdit).not.toHaveBeenCalled()
  expect(props.onCancel).not.toHaveBeenCalled()
  await user.click(save())
  dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(onEdit).toHaveBeenCalledWith(data))
  expect(props.onCancel).toHaveBeenCalledOnce()
  expect(createExternalAPI).not.toHaveBeenCalled()
})

it.each(['dataset.externalAPIForm.cancel', 'common.operation.close'])(
  'closes without saving through %s',
  async (name) => {
    const user = userEvent.setup()
    render(<AddExternalAPIModal {...props} />)
    await user.click(screen.getByRole('button', { name }))
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(createExternalAPI).not.toHaveBeenCalled()
  },
)
