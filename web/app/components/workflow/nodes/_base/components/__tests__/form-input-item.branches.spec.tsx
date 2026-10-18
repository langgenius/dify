import type { ComponentProps } from 'react'
import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { VarKindType } from '../../types'
import FormInputItem from '../form-input-item'

const { mockDynamicOptions, mockDynamicTreeOptions } = vi.hoisted(() => ({
  mockDynamicOptions: vi.fn(),
  mockDynamicTreeOptions: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.parameters.dynamicOptions.get': (input) =>
        mockDynamicOptions(input),
      'workspaces.current.plugin.parameters.dynamicTreeOptions.get': (input) =>
        mockDynamicTreeOptions(input),
    }),
  }
})

// The editor runtime is a browser boundary; keep form state and value serialization real.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ onChange, value }: { onChange: (value: string) => void; value: string }) => (
    <textarea aria-label="JSON" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

type Props = ComponentProps<typeof FormInputItem>
const createSchema = (overrides: Partial<Props['schema']> = {}): Props['schema'] => ({
  label: { en_US: 'Field', zh_Hans: '字段' },
  required: false,
  show_on: [],
  type: FormTypeEnum.select,
  variable: 'field',
  name: 'field',
  ...overrides,
})
const createOption = (value: string): FormOption => ({
  label: { en_US: value, zh_Hans: value },
  show_on: [],
  value,
})
const tool: Tool = {
  name: 'tool-1',
  author: 'Dify',
  label: { en_US: 'Tool', zh_Hans: 'Tool' },
  description: { en_US: 'Tool' },
  parameters: [],
  labels: [],
  output_schema: {},
}
const provider: ToolWithProvider = {
  id: 'provider-1',
  name: 'provider-1',
  plugin_id: 'plugin-1',
  author: 'Dify',
  label: { en_US: 'Provider', zh_Hans: 'Provider' },
  description: { en_US: 'Provider', zh_Hans: 'Provider' },
  icon: '/provider.svg',
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: false,
  labels: [],
  tools: [tool],
}

const renderForm = (props: Partial<Props> = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const onChange = vi.fn()
  const Form = () => {
    const [value, setValue] = useState<Props['value']>(
      props.value ?? {
        field: { type: VarKindType.constant, value: '' },
      },
    )
    return (
      <FormInputItem
        readOnly={false}
        nodeId="node-1"
        schema={createSchema()}
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  return {
    ...renderWorkflowFlowComponent(<Form />, { queryClient, nodes: [], edges: [] }),
    onChange,
  }
}

describe('FormInputItem selections', () => {
  beforeEach(() => {
    mockDynamicOptions.mockReset()
    mockDynamicOptions.mockResolvedValue({ options: [] })
    mockDynamicTreeOptions.mockReset()
    mockDynamicTreeOptions.mockResolvedValue({ options: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps static selection and the persisted value in sync', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm({
      schema: createSchema({ options: [createOption('basic'), createOption('pro')] }),
    })

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'basic' }))

    expect(screen.getByRole('combobox')).toHaveTextContent('basic')
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: 'basic' },
    })
    expect(mockDynamicOptions).not.toHaveBeenCalled()
  })

  it('adds and removes values without discarding other multi-select choices', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm({
      schema: createSchema({
        multiple: true,
        options: [createOption('alpha'), createOption('beta')],
      }),
      value: { field: { type: VarKindType.constant, value: ['alpha'] } },
    })

    await user.click(screen.getByRole('combobox', { name: 'alpha' }))
    await user.click(await screen.findByRole('option', { name: 'beta' }))
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: ['alpha', 'beta'] },
    })
    await user.click(screen.getByRole('option', { name: 'alpha' }))
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: ['beta'] },
    })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('combobox')).toHaveTextContent('beta')
  })

  it('loads tool options with provider context and saves the chosen value', async () => {
    const user = userEvent.setup()
    mockDynamicOptions.mockResolvedValue({ options: [createOption('remote')] })
    const { onChange } = renderForm({
      schema: createSchema({ type: FormTypeEnum.dynamicSelect }),
      currentProvider: provider,
      currentTool: tool,
      providerType: PluginCategoryEnum.tool,
      extraParams: { dependent_field: 'parent' },
    })

    expect(screen.getByRole('combobox')).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'remote' }))

    expect(mockDynamicOptions).toHaveBeenCalledExactlyOnceWith({
      query: {
        plugin_id: 'plugin-1',
        provider: 'provider-1',
        action: 'tool-1',
        parameter: 'field',
        provider_type: 'tool',
        parameter_values: JSON.stringify({ field: '', dependent_field: 'parent' }),
      },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: 'remote' },
    })
    expect(screen.getByRole('combobox')).toHaveTextContent('remote')
  })

  it('finishes loading without changing the saved value when options fail to load', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockDynamicOptions.mockRejectedValue(new Error('network'))
    const { onChange } = renderForm({
      schema: createSchema({ type: FormTypeEnum.dynamicSelect }),
      currentProvider: provider,
      currentTool: tool,
      providerType: PluginCategoryEnum.tool,
    })

    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('loads trigger options once using the selected credential', async () => {
    const user = userEvent.setup()
    mockDynamicOptions.mockResolvedValue({ options: [createOption('trigger-option')] })
    const { onChange } = renderForm({
      schema: createSchema({ type: FormTypeEnum.dynamicSelect, multiple: true }),
      currentProvider: { ...provider, credential_id: 'credential-1' },
      currentTool: tool,
      providerType: PluginCategoryEnum.trigger,
      value: { field: { type: VarKindType.constant, value: [] } },
    })

    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'trigger-option' }))

    expect(mockDynamicOptions).toHaveBeenCalledExactlyOnceWith({
      query: {
        plugin_id: 'plugin-1',
        provider: 'provider-1',
        action: 'tool-1',
        parameter: 'field',
        provider_type: 'trigger',
        credential_id: 'credential-1',
      },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: ['trigger-option'] },
    })
  })

  it('saves JSON edits as constant strings', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm({
      schema: createSchema({ type: FormTypeEnum.object }),
      value: { field: { type: VarKindType.constant, value: '{"enabled":false}' } },
    })
    await user.clear(screen.getByRole('textbox', { name: 'JSON' }))
    await user.paste('{"enabled":true}')

    expect(screen.getByRole('textbox', { name: 'JSON' })).toHaveValue('{"enabled":true}')
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: '{"enabled":true}' },
    })
  })
})

it('loads nested tool choices with sibling values and preserves a multi-selection when reopened', async () => {
  const user = userEvent.setup()
  mockDynamicTreeOptions.mockResolvedValue({
    options: [
      {
        value: 'parent',
        label: { en_US: 'Parent' },
        children: [
          { value: 'first', label: { en_US: 'First' } },
          { value: 'second', label: { en_US: 'Second' } },
        ],
      },
    ],
  })
  const { onChange } = renderForm({
    schema: createSchema({
      type: FormTypeEnum.dynamicTreeSelect,
      multiple: true,
      dynamic_select_lazy_load: true,
      placeholder: { en_US: 'Choose a tree', zh_Hans: '选择树' },
    }),
    currentProvider: { ...provider, credential_id: 'credential-1' },
    currentTool: tool,
    providerType: PluginCategoryEnum.tool,
    value: {
      region: { type: VarKindType.constant, value: 'us' },
      field: { type: VarKindType.constant, value: ['first'] },
    },
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'First' })).toBeEnabled())
  expect(mockDynamicTreeOptions).toHaveBeenCalledWith({
    query: {
      plugin_id: 'plugin-1',
      provider: 'provider-1',
      action: 'tool-1',
      parameter: 'field',
      credential_id: 'credential-1',
      parameter_values: JSON.stringify({ region: 'us', field: ['first'] }),
    },
  })
  await user.click(screen.getByRole('button', { name: 'First' }))
  await user.click(await screen.findByRole('option', { name: 'Second' }))
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ field: { type: VarKindType.constant, value: ['first', 'second'] } }),
  )
  expect(mockDynamicTreeOptions.mock.calls.length).toBeGreaterThan(1)
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'First, Second' }))
  expect(await screen.findByRole('option', { name: 'Second' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})
