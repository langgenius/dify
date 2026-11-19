import type { ComponentProps } from 'react'
import type { NodeOutPutVar } from '../../../../types'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { BlockEnum, InputVarType, VarType } from '../../../../types'
import FormContentPreview, { FormContentPreviewTrigger } from '../form-content-preview'

const preview = vi.hoisted(() => vi.fn())
const chatPreview = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.preview.post': preview,
      'apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form.preview.post':
        chatPreview,
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
  overrides: Partial<ComponentProps<typeof FormContentPreviewTrigger>> = {},
) =>
  renderWorkflowComponent(
    readOnly ? (
      <FormContentPreview {...props} {...overrides} readOnly />
    ) : (
      <FormContentPreviewTrigger {...props} {...overrides} />
    ),
    {
      ...options,
      initialStoreState: {
        panelWidth: 320,
        nodes: [createNode({ id: 'node-1', data: { title: 'Classifier' } })],
        ...options.initialStoreState,
      },
    },
  )

const previewLabel = 'workflowHumanInput.nodes.humanInput.formContent.preview'
const savedDraft = async () => ({ hash: 'saved', updatedAt: 1 })
const sourceNode = createNode({
  id: 'source',
  data: { title: 'Contract source', type: BlockEnum.Code },
})
const sourceVars: NodeOutPutVar = {
  nodeId: 'source',
  title: 'Contract source',
  vars: [
    { variable: 'draft', type: VarType.string },
    {
      variable: 'object',
      type: VarType.object,
      children: [{ variable: 'name', type: VarType.string }],
    },
    { variable: 'amount', type: VarType.number },
    { variable: 'approved', type: VarType.boolean },
    { variable: 'settings', type: VarType.object },
    { variable: 'options', type: VarType.arrayString },
  ],
}

const submitPreview = async (user: ReturnType<typeof userEvent.setup>) => {
  const form = screen.getByRole('form', { name: previewLabel })
  await user.click(within(form).getByRole('button', { name: previewLabel }))
}

beforeEach(() => {
  preview.mockReset()
  chatPreview.mockReset()
})

it('waits for the saved workflow before displaying the real server markdown', async () => {
  let finishSave!: () => void
  const saving = new Promise<{ hash: string; updatedAt: number }>((resolve) => {
    finishSave = () => resolve({ hash: 'saved-draft', updatedAt: 1 })
  })
  preview.mockResolvedValue({ form_content: 'Resolved server preview', inputs: [], actions: [] })
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: () => saving } })
  const status = screen.getByRole('status')
  expect(status).toBeEmptyDOMElement()
  await userEvent.setup().click(
    screen.getByRole('button', {
      name: 'workflowHumanInput.nodes.humanInput.formContent.preview',
    }),
  )
  expect(status).toHaveTextContent('common.loading')
  expect(within(status).queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeEnabled()
  expect(preview).not.toHaveBeenCalled()
  expect(screen.queryByText(props.content)).not.toBeInTheDocument()
  await act(async () => finishSave())
  expect(
    await screen.findByText('Resolved server preview', {}, { timeout: 5000 }),
  ).toBeInTheDocument()
  expect(screen.queryByText(props.content)).not.toBeInTheDocument()
  expect(preview).toHaveBeenCalledExactlyOnceWith(
    {
      params: { app_id: 'app-1', node_id: 'node-1' },
      body: { inputs: {} },
    },
    { context: { silent: true } },
  )
  expect(status).toBeEmptyDOMElement()
})

it('shows a server failure and retries without presenting local content as the result', async () => {
  const user = userEvent.setup()
  preview
    .mockRejectedValueOnce(new Error('Server preview failed'))
    .mockResolvedValue({ form_content: 'Retried preview', inputs: [], actions: [] })
  renderPreview({
    hooksStoreProps: { doSyncWorkflowDraft: async () => ({ hash: 'saved', updatedAt: 1 }) },
  })
  await user.click(
    screen.getByRole('button', { name: 'workflowHumanInput.nodes.humanInput.formContent.preview' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
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

it.each([
  { mode: 'workflow' as const, selector: 'source.draft', field: /draft/ },
  { mode: 'advanced-chat' as const, selector: 'source.object.name', field: /name/ },
])(
  'collects missing dependency values before requesting a $mode preview',
  async ({ mode, selector, field }) => {
    const user = userEvent.setup()
    const endpoint = mode === 'workflow' ? preview : chatPreview
    endpoint.mockResolvedValue({
      form_content: 'Server-resolved contract',
      inputs: [],
      actions: [],
    })
    renderPreview(
      {
        resource: { kind: 'app', appId: 'app-1', mode },
        hooksStoreProps: { doSyncWorkflowDraft: savedDraft },
      },
      false,
      {
        content: `Review {{#${selector}#}} {{#$output.feedback#}}`,
        availableVars: [sourceVars],
        availableNodes: [sourceNode],
      },
    )

    await user.click(screen.getByRole('button', { name: previewLabel }))
    const input = await screen.findByRole('textbox', { name: field })
    expect(endpoint).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: /feedback/ })).not.toBeInTheDocument()
    await user.type(input, 'Reviewed contract')
    await submitPreview(user)

    expect(await screen.findByText('Server-resolved contract')).toBeInTheDocument()
    expect(endpoint).toHaveBeenCalledExactlyOnceWith(
      {
        params: { app_id: 'app-1', node_id: 'node-1' },
        body: { inputs: { [`#${selector}#`]: 'Reviewed contract' } },
      },
      { context: { silent: true } },
    )
  },
)

it.each([
  { selector: 'source.amount', value: 0 },
  { selector: 'source.approved', value: false },
  { selector: 'source.draft', value: '' },
])(
  'uses a cached dependency value of $value without requesting it again',
  async ({ selector, value }) => {
    const cachedValues = new Map<string, unknown>([[selector, value]])
    preview.mockResolvedValue({ form_content: 'Cached server preview', inputs: [], actions: [] })
    renderPreview(
      {
        hooksStoreProps: {
          doSyncWorkflowDraft: savedDraft,
          hasSetInspectVar: (nodeId, name) => cachedValues.has(`${nodeId}.${name}`),
        },
      },
      false,
      {
        content: `{{#${selector}#}}`,
        availableVars: [sourceVars],
        availableNodes: [sourceNode],
      },
    )

    await userEvent.setup().click(screen.getByRole('button', { name: previewLabel }))
    expect(await screen.findByText('Cached server preview')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: previewLabel })).not.toBeInTheDocument()
    expect(preview).toHaveBeenCalledExactlyOnceWith(
      { params: { app_id: 'app-1', node_id: 'node-1' }, body: { inputs: {} } },
      { context: { silent: true } },
    )
  },
)

it('preserves typed dependency values when retrying a failed preview', async () => {
  const user = userEvent.setup()
  preview
    .mockRejectedValueOnce(new Error('Server preview failed'))
    .mockResolvedValue({ form_content: 'Retried with contract', inputs: [], actions: [] })
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: savedDraft } }, false, {
    content: '{{#source.draft#}}',
    availableVars: [sourceVars],
    availableNodes: [sourceNode],
  })
  await user.click(screen.getByRole('button', { name: previewLabel }))
  await user.type(await screen.findByRole('textbox', { name: /draft/ }), 'Retained contract')
  await submitPreview(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
  expect(screen.getByRole('textbox', { name: /draft/ })).toHaveValue('Retained contract')
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

  expect(await screen.findByText('Retried with contract')).toBeInTheDocument()
  expect(preview).toHaveBeenCalledTimes(2)
  for (const [request] of preview.mock.calls) {
    expect(request.body).toEqual({ inputs: { '#source.draft#': 'Retained contract' } })
  }
})

it('lets the user supply dependency values when cached data cannot render the server preview', async () => {
  const user = userEvent.setup()
  preview
    .mockRejectedValueOnce(new Error('Cached value is not available'))
    .mockResolvedValue({ form_content: 'Manual server preview', inputs: [], actions: [] })
  renderPreview(
    {
      hooksStoreProps: { doSyncWorkflowDraft: savedDraft, hasSetInspectVar: () => true },
    },
    false,
    {
      content: '{{#source.draft#}}',
      availableVars: [sourceVars],
      availableNodes: [sourceNode],
    },
  )
  await user.click(screen.getByRole('button', { name: previewLabel }))
  expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
  await user.type(await screen.findByRole('textbox', { name: /draft/ }), 'Manual contract')
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(await screen.findByText('Manual server preview')).toBeInTheDocument()
  expect(preview.mock.calls[1]?.[0].body).toEqual({
    inputs: { '#source.draft#': 'Manual contract' },
  })
})

it('submits number, boolean and JSON dependency values using their declared types', async () => {
  const user = userEvent.setup()
  preview.mockResolvedValue({ form_content: 'Typed server preview', inputs: [], actions: [] })
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: savedDraft } }, false, {
    content: '{{#source.amount#}} {{#source.approved#}} {{#source.settings#}}',
    availableVars: [sourceVars],
    availableNodes: [sourceNode],
  })
  await user.click(screen.getByRole('button', { name: previewLabel }))
  await user.type(await screen.findByLabelText(/amount/), '0')
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(screen.getByTestId('monaco-editor'))
  await user.paste('{"term":30}')
  await submitPreview(user)

  expect(await screen.findByText('Typed server preview')).toBeInTheDocument()
  expect(preview).toHaveBeenCalledExactlyOnceWith(
    {
      params: { app_id: 'app-1', node_id: 'node-1' },
      body: {
        inputs: {
          '#source.amount#': 0,
          '#source.approved#': false,
          '#source.settings#': { term: 30 },
        },
      },
    },
    { context: { silent: true } },
  )
})

it('collects variable defaults and select options without treating output fields as dependencies', async () => {
  const user = userEvent.setup()
  preview.mockResolvedValue({ form_content: 'Server field defaults', inputs: [], actions: [] })
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: savedDraft } }, false, {
    content: '{{#$output.feedback#}} {{#$output.choice#}}',
    formInputs: [
      {
        type: InputVarType.paragraph,
        output_variable_name: 'feedback',
        default: { type: 'variable', selector: ['source', 'draft'], value: '' },
      },
      {
        type: InputVarType.select,
        output_variable_name: 'choice',
        option_source: { type: 'variable', selector: ['source', 'options'], value: [] },
      },
    ],
    availableVars: [sourceVars],
    availableNodes: [sourceNode],
  })
  await user.click(screen.getByRole('button', { name: previewLabel }))
  await user.type(await screen.findByRole('textbox', { name: /draft/ }), 'Default feedback')
  expect(screen.queryByRole('textbox', { name: /feedback/ })).not.toBeInTheDocument()
  await user.click(screen.getByTestId('monaco-editor'))
  await user.paste('["approve","revise"]')
  await submitPreview(user)

  expect(await screen.findByText('Server field defaults')).toBeInTheDocument()
  expect(preview).toHaveBeenCalledExactlyOnceWith(
    {
      params: { app_id: 'app-1', node_id: 'node-1' },
      body: {
        inputs: {
          '#source.draft#': 'Default feedback',
          '#source.options#': ['approve', 'revise'],
        },
      },
    },
    { context: { silent: true } },
  )
})

it('shows an inline required-field error before requesting a preview and accepts the corrected value', async () => {
  const user = userEvent.setup()
  const sync = vi.fn(savedDraft)
  preview.mockResolvedValue({ form_content: 'Validated server preview', inputs: [], actions: [] })
  renderPreview({ hooksStoreProps: { doSyncWorkflowDraft: sync } }, false, {
    content: '{{#source.draft#}}',
    availableVars: [sourceVars],
    availableNodes: [sourceNode],
  })

  await user.click(screen.getByRole('button', { name: previewLabel }))
  const form = await screen.findByRole('form', { name: previewLabel })
  await submitPreview(user)
  expect(within(form).getByRole('alert')).toHaveTextContent('workflow.errorMsg.fieldRequired')
  expect(sync).not.toHaveBeenCalled()
  expect(preview).not.toHaveBeenCalled()

  await user.type(within(form).getByRole('textbox', { name: /draft/ }), 'Validated contract')
  expect(within(form).queryByRole('alert')).not.toBeInTheDocument()
  await submitPreview(user)
  expect(await screen.findByText('Validated server preview')).toBeInTheDocument()
  expect(sync).toHaveBeenCalledTimes(1)
  expect(preview).toHaveBeenCalledExactlyOnceWith(
    {
      params: { app_id: 'app-1', node_id: 'node-1' },
      body: { inputs: { '#source.draft#': 'Validated contract' } },
    },
    { context: { silent: true } },
  )
})

it('ignores a closed preview request failure after reopening with different dependencies', async () => {
  const user = userEvent.setup()
  let failOldPreview!: (error: Error) => void
  preview.mockReturnValue(
    new Promise((_resolve, reject) => {
      failOldPreview = reject
    }),
  )
  const view = renderPreview(
    {
      hooksStoreProps: {
        doSyncWorkflowDraft: savedDraft,
        hasSetInspectVar: (nodeId, name) => nodeId === 'source' && name === 'draft',
      },
    },
    false,
    {
      content: '{{#source.draft#}}',
      availableVars: [sourceVars],
      availableNodes: [sourceNode],
    },
  )

  await user.click(screen.getByRole('button', { name: previewLabel }))
  expect(preview).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  view.rerender(
    <FormContentPreviewTrigger
      {...props}
      content="{{#source.amount#}}"
      availableVars={[sourceVars]}
      availableNodes={[sourceNode]}
    />,
  )
  await user.click(screen.getByRole('button', { name: previewLabel }))
  expect(await screen.findByLabelText(/amount/)).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /draft/ })).not.toBeInTheDocument()

  await act(async () => failOldPreview(new Error('The closed preview failed')))

  expect(screen.getByLabelText(/amount/)).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: /draft/ })).not.toBeInTheDocument()
  expect(preview).toHaveBeenCalledTimes(1)
})
