import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import FormContentPreview from '../form-content-preview'

const preview = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.preview.post': preview,
    }),
  }
})

const props = {
  nodeId: 'node-1',
  content: 'Unsaved local content',
  formInputs: [],
  userActions: [],
  onClose: () => {},
}
const renderPreview = (
  options: Parameters<typeof renderWorkflowComponent>[1] = {},
  readOnly = false,
) =>
  renderWorkflowComponent(<FormContentPreview {...props} readOnly={readOnly} />, {
    ...options,
    initialStoreState: {
      panelWidth: 320,
      nodes: [createNode({ id: 'node-1', data: { title: 'Classifier' } })],
    },
  })

it('waits for the saved workflow before displaying the real server markdown', async () => {
  let finishSave!: () => void
  const saving = new Promise<{ hash: string; updatedAt: number }>((resolve) => {
    finishSave = () => resolve({ hash: 'saved-draft', updatedAt: 1 })
  })
  preview.mockResolvedValue({ form_content: 'Resolved server preview', inputs: [], actions: [] })
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: () => saving } })
  expect(screen.getByRole('status')).toHaveTextContent('common.loading')
  expect(preview).not.toHaveBeenCalled()
  expect(screen.queryByText(props.content)).not.toBeInTheDocument()
  await act(async () => finishSave())
  expect(await screen.findByText('Resolved server preview')).toBeInTheDocument()
  expect(screen.queryByText(props.content)).not.toBeInTheDocument()
  expect(preview).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'app-1', node_id: 'node-1' },
    body: { inputs: {} },
  })
})

it('shows a server failure and retries without presenting local content as the result', async () => {
  const user = userEvent.setup()
  preview
    .mockRejectedValueOnce(new Error('Server preview failed'))
    .mockResolvedValue({ form_content: 'Retried preview', inputs: [], actions: [] })
  renderPreview({
    hooksStoreProps: { doSyncWorkflowDraft: async () => ({ hash: 'saved', updatedAt: 1 }) },
  })
  expect(await screen.findByText('Server preview failed')).toBeInTheDocument()
  expect(screen.queryByText(props.content)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(await screen.findByText('Retried preview')).toBeInTheDocument()
})

it('renders historical readonly content without loading the current draft', async () => {
  const sync = vi.fn()
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: sync } }, true)
  expect(await screen.findByText(props.content)).toBeInTheDocument()
  expect(preview).not.toHaveBeenCalled()
  expect(sync).not.toHaveBeenCalled()
})
