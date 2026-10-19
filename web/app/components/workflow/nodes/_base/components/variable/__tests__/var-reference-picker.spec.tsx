import type { ComponentProps } from 'react'
import type { consoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import VarReferencePicker from '../var-reference-picker'

type Props = ComponentProps<typeof VarReferencePicker>
const fetchOptions = vi.hoisted(() =>
  vi.fn<typeof consoleClient.workspaces.current.plugin.parameters.dynamicOptions.get>(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.parameters.dynamicOptions.get': (input) => fetchOptions(input),
    }),
  }
})

function setup(props: Partial<Omit<Props, 'onChange' | 'onRemove'>> = {}, chatflow = false) {
  const onChange = vi.fn<Props['onChange']>()
  const onRemove = vi.fn()
  function Picker() {
    const [value, setValue] = useState<Props['value']>(props.value ?? [])
    const [visible, setVisible] = useState(true)
    return visible ? (
      <VarReferencePicker
        nodeId="current"
        readonly={false}
        placeholder="Pick a variable"
        {...props}
        value={value}
        onChange={(next, kind, variable) => {
          onChange(next, kind, variable)
          setValue(next)
        }}
        onRemove={() => {
          onRemove()
          setVisible(false)
        }}
      />
    ) : null
  }
  const start = createStartNode({
    id: 'start',
    data: {
      title: 'Start',
      variables: [
        { variable: 'question', label: 'Question', type: InputVarType.textInput, required: false },
      ],
    },
  })
  const source = createNode({
    id: 'source',
    data: {
      title: 'Source',
      type: BlockEnum.Code,
      outputs: {
        answer: { type: VarType.string, children: null },
        payload: { type: VarType.object, children: null },
      },
    },
  })
  const current = createNode({ id: 'current', data: { title: 'Current' } })
  const unrelated = createNode({
    id: 'unrelated',
    data: {
      title: 'Other branch',
      type: BlockEnum.Code,
      outputs: { excluded: { type: VarType.string, children: null } },
    },
  })
  const rendered = renderWorkflowEditor(<Picker />, {
    resource: { kind: 'app', appId: 'app-1', mode: chatflow ? 'advanced-chat' : 'workflow' },
    nodes: [start, source, current, unrelated],
    edges: [
      createEdge({ source: 'start', target: 'source' }),
      createEdge({ source: 'source', target: 'current' }),
    ],
    initialStoreState: {
      environmentVariables: [
        { id: 'env-key', name: 'API_KEY', value: 'example', value_type: 'string', description: '' },
      ],
    },
  })
  return { ...rendered, onChange, onRemove, user: userEvent.setup() }
}
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Pick a variable/ }))
  return screen.findByRole('dialog')
}
const provider = selectToolsWithProvider([
  createToolProviderFixture({
    id: 'vendor/search/search',
    name: 'search',
    plugin_id: 'vendor/search',
    tools: [
      {
        name: 'lookup',
        author: 'Vendor',
        label: { en_US: 'Lookup' },
        description: { en_US: 'Look up records' },
        parameters: [],
      },
    ],
  }),
])[0]!
const dynamicProps = {
  currentProvider: provider,
  currentTool: provider.tools[0]!,
  isSupportConstantValue: true,
  schema: {
    variable: 'field',
    type: FormTypeEnum.dynamicSelect,
    placeholder: { en_US: 'Choose a field', zh_Hans: '选择字段' },
  },
  value: '',
} satisfies Partial<Props>
beforeEach(() => fetchOptions.mockReset())

it('resolves upstream outputs, filters out unrelated branches, and displays the selected reference', async () => {
  const { user, onChange } = setup()
  const picker = await openPicker(user)
  expect(within(picker).queryByText('excluded')).not.toBeInTheDocument()
  const search = within(picker).getByRole('searchbox')
  await user.type(search, 'answer')
  await user.click(within(picker).getByText('answer'))
  expect(onChange).toHaveBeenCalledWith(
    ['source', 'answer'],
    VarKindType.constant,
    expect.objectContaining({ variable: 'answer', type: VarType.string }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('Source')).toBeInTheDocument()
  expect(screen.getByText('answer')).toBeInTheDocument()
})

it('selects an object output through its public reference path', async () => {
  const { user, onChange } = setup()
  await user.click(within(await openPicker(user)).getByText('payload'))
  expect(onChange).toHaveBeenCalledWith(
    ['source', 'payload'],
    VarKindType.constant,
    expect.objectContaining({ variable: 'payload', type: VarType.object }),
  )
  expect(screen.getByText('payload')).toBeInTheDocument()
})

it.each([VarKindType.constant, VarKindType.variable])(
  'clears a selected reference in %s mode',
  async (kind) => {
    const { user, onChange } = setup({
      value: ['source', 'answer'],
      defaultVarKindType: kind,
      isSupportConstantValue: kind === VarKindType.variable,
    })
    expect(screen.getByText('Source')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(onChange).toHaveBeenCalledWith(kind === VarKindType.constant ? '' : [], kind, undefined)
    expect(screen.getByText('Pick a variable')).toBeInTheDocument()
  },
)

it('keeps a readonly reference unchanged', async () => {
  const { user, onChange } = setup({ readonly: true })
  await user.click(screen.getByText('Pick a variable'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})

it('opens the real picker from a custom trigger', async () => {
  const { user, onChange } = setup({ trigger: <button type="button">Choose output</button> })
  await user.click(screen.getByRole('button', { name: 'Choose output' }))
  await user.click(within(await screen.findByRole('dialog')).getByText('answer'))
  expect(onChange).toHaveBeenCalledWith(
    ['source', 'answer'],
    VarKindType.constant,
    expect.objectContaining({ type: VarType.string }),
  )
})

it('normalizes a chatflow system variable to its public selector', async () => {
  const { user, onChange } = setup({}, true)
  const picker = await openPicker(user)
  await user.click(within(picker).getByText('query'))
  expect(onChange).toHaveBeenCalledWith(
    ['sys', 'query'],
    VarKindType.constant,
    expect.objectContaining({ type: VarType.string }),
  )
})

it('selects an environment variable from the real workflow store', async () => {
  const { user, onChange } = setup()
  await user.click(within(await openPicker(user)).getByText('API_KEY'))
  expect(onChange).toHaveBeenCalledWith(
    ['env', 'API_KEY'],
    VarKindType.constant,
    expect.objectContaining({ type: VarType.string }),
  )
  expect(screen.getByText('API_KEY')).toBeInTheDocument()
})

it('explains a reference whose source node no longer exists', async () => {
  const { user } = setup({ value: ['removed', 'answer'] })
  await user.hover(screen.getByText('answer'))
  expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeInTheDocument()
})

it('opens the real variable picker from a table add action', async () => {
  const { user, onChange } = setup({
    value: ['source', 'answer'],
    isAddBtnTrigger: true,
    isInTable: true,
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  await user.click(within(await screen.findByRole('dialog')).getByText('payload'))
  expect(onChange).toHaveBeenCalledWith(
    ['source', 'payload'],
    VarKindType.constant,
    expect.objectContaining({ type: VarType.object }),
  )
})

it('loads dynamic choices at the service boundary and persists the selected value', async () => {
  fetchOptions.mockResolvedValue({
    options: [
      { value: 'one', label: { en_US: 'First field' } },
      { value: 'two', label: { en_US: 'Second field' } },
    ],
  })
  const { user, onChange } = setup(dynamicProps)
  const select = await screen.findByRole('combobox')
  await waitFor(() => expect(select).toBeEnabled())
  await user.click(select)
  await user.click(screen.getByRole('option', { name: 'Second field' }))
  expect(onChange).toHaveBeenCalledWith('two', VarKindType.constant, undefined)
  expect(select).toHaveTextContent('Second field')
  expect(fetchOptions).toHaveBeenCalledExactlyOnceWith({
    query: {
      plugin_id: 'vendor/search',
      provider: 'search',
      action: 'lookup',
      parameter: 'field',
      provider_type: 'tool',
    },
  })
})

it('allows removing a table row while its dynamic options are loading', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof fetchOptions>>>()
  fetchOptions.mockReturnValue(request.promise)
  const { user, onRemove } = setup({ ...dynamicProps, isInTable: true })
  expect(screen.getByRole('combobox')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onRemove).toHaveBeenCalledOnce()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await act(async () => request.resolve({ options: [] }))
})
