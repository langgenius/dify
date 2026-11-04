import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import type { RAGPipelineVariable } from '@/models/pipeline'
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createRagPipelineSliceSlice } from '@/app/components/rag-pipeline/store'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createPipelineVariable } from '@/test/pipeline-variables'
import InputFieldEditorPanel from '../editor'
import InputFieldPanel from '../index'

// Catalog icon lookup is independent of field editing and graph reference updates.
vi.mock('@/app/components/workflow/hooks/use-tool-icon', () => ({ useToolIcon: () => '' }))

const source: Node<DataSourceNodeType> = {
  id: 'source-node',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.DataSource,
    title: 'Knowledge source',
    desc: '',
    plugin_id: 'plugin-1',
    provider_type: 'online_document',
    provider_name: 'source',
    datasource_name: 'source',
    datasource_label: 'Source',
    datasource_parameters: {},
    datasource_configurations: {},
  },
}
const consumer = (id: string, variable: string, nodeId = 'source-node'): Node<CodeNodeType> => ({
  id,
  position: { x: 200, y: 0 },
  data: {
    type: BlockEnum.Code,
    title: id,
    desc: '',
    variables: [{ variable: 'input', value_selector: ['rag', nodeId, variable] }],
    code_language: 'python3',
    code: '',
    outputs: {},
  },
})

// Connect the actual editor to the public panel state and expose the resulting graph.
const PanelHarness = () => {
  const editor = useStore((s) => s.inputFieldEditPanelProps)
  const nodes = useNodes<Partial<CodeNodeType>>()
  return (
    <>
      <InputFieldPanel />
      {editor && <InputFieldEditorPanel {...editor} />}
      <output aria-label="Graph">
        {JSON.stringify(nodes.map((node) => ({ id: node.id, variables: node.data.variables })))}
      </output>
    </>
  )
}

const renderPanel = (
  options: {
    variables?: RAGPipelineVariable[]
    withConsumer?: boolean
    canEdit?: boolean
  } = {},
) => {
  const syncDraft = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture({ workflow_file_upload_limit: 10 }),
  )
  const view = renderWorkflowFlowComponent(<PanelHarness />, {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    queryClient,
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
    nodes: options.withConsumer
      ? [source, consumer('consumer', 'source'), consumer('unrelated', 'source')]
      : [source],
    edges: options.withConsumer ? [{ id: 'edge', source: source.id, target: 'consumer' }] : [],
    initialStoreState: { ragPipelineVariables: options.variables ?? [], showInputFieldPanel: true },
    hooksStoreProps: {
      doSyncWorkflowDraft: syncDraft,
      accessControl: { ...fullWorkflowAccessControl, canEdit: options.canEdit ?? true },
    },
  })
  return { ...view, syncDraft, user: userEvent.setup() }
}

const submit = () => screen.getByRole('button', { name: /operation.submit/ })
const variableInput = () => screen.getByRole('textbox', { name: /variableConfig.varName/ })

it('adds a datasource field through the editor, retains global fields and synchronizes the draft', async () => {
  const global = createPipelineVariable({
    belong_to_node_id: 'shared',
    variable: 'global',
    label: 'Global input',
  })
  const { user, store, syncDraft } = renderPanel({ variables: [global] })
  expect(screen.getByText('Knowledge source')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.add' })[0]!)
  expect(screen.getByRole('button', { name: /operations.preview/ })).toBeDisabled()
  await user.type(variableInput(), 'source_url')
  await user.tab()
  await user.type(screen.getByRole('textbox', { name: /variableConfig.maxLength/ }), '100')
  await user.click(submit())
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', { name: /variableConfig.varName/ }),
    ).not.toBeInTheDocument(),
  )
  expect(
    screen.getByRole('button', { name: 'common.operation.edit', description: 'source_url' }),
  ).toBeEnabled()
  expect(store.getState().ragPipelineVariables).toEqual([
    expect.objectContaining({
      variable: 'source_url',
      belong_to_node_id: 'source-node',
      max_length: 100,
    }),
    global,
  ])
  act(() => store.getState().flushPendingSync())
  expect(syncDraft).toHaveBeenCalledOnce()
})

it('rejects a name used by another entrance and allows correction in the same editor', async () => {
  const toastError = vi.spyOn(toast, 'error').mockReturnValue('error')
  const global = createPipelineVariable({ belong_to_node_id: 'shared', variable: 'taken' })
  const local = createPipelineVariable({ variable: 'original' })
  const { user, store } = renderPanel({ variables: [global, local] })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.edit', description: 'original' }),
  )
  await user.clear(variableInput())
  await user.type(variableInput(), 'taken')
  await user.click(submit())
  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith(
      'datasetPipeline.inputFieldPanel.error.variableDuplicate',
    ),
  )
  expect(variableInput()).toHaveValue('taken')
  expect(store.getState().ragPipelineVariables).toEqual([global, local])
  await user.clear(variableInput())
  await user.type(variableInput(), 'available')
  await user.click(submit())
  await waitFor(() => expect(store.getState().inputFieldEditPanelProps).toBeNull())
  expect(store.getState().ragPipelineVariables?.map((v) => v.variable)).toEqual([
    'available',
    'taken',
  ])
  act(() => store.getState().flushPendingSync())
})

it('renames real downstream references while leaving another branch untouched', async () => {
  const { user, store } = renderPanel({ variables: [createPipelineVariable()], withConsumer: true })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.edit', description: 'source' }),
  )
  await user.clear(variableInput())
  await user.type(variableInput(), 'renamed')
  await user.click(submit())
  await waitFor(() => expect(store.getState().inputFieldEditPanelProps).toBeNull())
  const graph = JSON.parse(screen.getByRole('status', { name: 'Graph' }).textContent!)
  expect(graph.find((n: Node) => n.id === 'consumer').variables[0].value_selector).toEqual([
    'rag',
    'source-node',
    'renamed',
  ])
  expect(graph.find((n: Node) => n.id === 'unrelated').variables[0].value_selector).toEqual([
    'rag',
    'source-node',
    'source',
  ])
  expect(store.getState().ragPipelineVariables?.[0]?.variable).toBe('renamed')
  act(() => store.getState().flushPendingSync())
})

it('requires confirmation to remove a referenced field and clears only its downstream references', async () => {
  const variable = createPipelineVariable()
  const { user, store } = renderPanel({ variables: [variable], withConsumer: true })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.remove', description: 'source' }),
  )
  let dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(store.getState().ragPipelineVariables).toEqual([variable])
  await user.click(
    screen.getByRole('button', { name: 'common.operation.remove', description: 'source' }),
  )
  dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(store.getState().ragPipelineVariables).toEqual([])
  const graph = JSON.parse(screen.getByRole('status', { name: 'Graph' }).textContent!)
  expect(graph.find((n: Node) => n.id === 'consumer').variables[0].value_selector).toEqual([])
  expect(graph.find((n: Node) => n.id === 'unrelated').variables[0].value_selector).toEqual([
    'rag',
    'source-node',
    'source',
  ])
  act(() => store.getState().flushPendingSync())
})

it('reorders fields without persisting sortable metadata and removes an unused field directly', async () => {
  const first = createPipelineVariable({ variable: 'first' })
  const second = createPipelineVariable({ variable: 'second' })
  const { user, store } = renderPanel({ variables: [first, second] })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.moveDown', description: 'first' }),
  )
  expect(store.getState().ragPipelineVariables).toEqual([second, first])
  await user.click(
    screen.getByRole('button', { name: 'common.operation.remove', description: 'second' }),
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(store.getState().ragPipelineVariables).toEqual([first])
  act(() => store.getState().flushPendingSync())
})

it('makes fields read-only while previewing and restores editing when preview closes', async () => {
  const { user, store } = renderPanel({ variables: [createPipelineVariable()] })
  const preview = screen.getByRole('button', { name: /operations.preview/ })
  await user.click(preview)
  expect(store.getState().showInputFieldPreviewPanel).toBe(true)
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  for (const add of screen.getAllByRole('button', { name: 'common.operation.add' }))
    expect(add).toBeDisabled()
  await user.click(preview)
  expect(store.getState().showInputFieldPreviewPanel).toBe(false)
  expect(screen.getByRole('button', { name: 'common.operation.edit' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(store.getState()).toMatchObject({
    showInputFieldPanel: false,
    showInputFieldPreviewPanel: false,
    inputFieldEditPanelProps: null,
  })
})

it('keeps all field mutation controls unavailable without edit permission', () => {
  const { store, syncDraft } = renderPanel({
    variables: [createPipelineVariable()],
    canEdit: false,
  })
  for (const add of screen.getAllByRole('button', { name: 'common.operation.add' }))
    expect(add).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  act(() => store.getState().flushPendingSync())
  expect(syncDraft).not.toHaveBeenCalled()
})

it('cancels editing without changing the stored field', async () => {
  const variable = createPipelineVariable()
  const { user, store, syncDraft } = renderPanel({ variables: [variable] })
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  await user.clear(variableInput())
  await user.type(variableInput(), 'discarded')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(screen.queryByRole('textbox', { name: /variableConfig.varName/ })).not.toBeInTheDocument()
  expect(store.getState().ragPipelineVariables).toEqual([variable])
  act(() => store.getState().flushPendingSync())
  expect(syncDraft).not.toHaveBeenCalled()
})

it('rejects a name added during an earlier editing session', async () => {
  const toastError = vi.spyOn(toast, 'error').mockReturnValue('error')
  const { user, store } = renderPanel({
    variables: [createPipelineVariable({ variable: 'original' })],
  })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.edit', description: 'original' }),
  )
  await user.clear(variableInput())
  await user.type(variableInput(), 'taken_later')
  await user.click(submit())
  await waitFor(() => expect(store.getState().inputFieldEditPanelProps).toBeNull())
  await user.click(screen.getAllByRole('button', { name: 'common.operation.add' })[1]!)
  await user.type(variableInput(), 'taken_later')
  await user.tab()
  await user.type(screen.getByRole('textbox', { name: /variableConfig.maxLength/ }), '100')
  await user.click(submit())
  await waitFor(() =>
    expect(toastError).toHaveBeenCalledWith(
      'datasetPipeline.inputFieldPanel.error.variableDuplicate',
    ),
  )
  expect(variableInput()).toHaveValue('taken_later')
  expect(store.getState().ragPipelineVariables).toHaveLength(1)
  act(() => store.getState().flushPendingSync())
})
