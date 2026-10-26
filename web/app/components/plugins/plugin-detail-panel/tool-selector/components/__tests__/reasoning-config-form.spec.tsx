import type { ReasoningConfigValue } from '../reasoning-config-form'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import { ReasoningConfigForm } from '../reasoning-config-form'

const render = createNuqsTestRenderer((ui) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedAppDslVersion(queryClient)
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-4.1',
          label: { en_US: 'gpt-4.1' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  return renderWorkflowFlowComponent(ui, {
    queryClient,
    nodes: [
      createNode({
        id: 'node',
        data: {
          type: BlockEnum.Code,
          title: 'Files source',
          outputs: { field: { type: VarType.arrayFile } },
        },
      }),
      createNode({ id: 'node-1' }),
    ],
    edges: [createEdge({ source: 'node', target: 'node-1' })],
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': async () => ({
        data: [createAppDetailFixture({ id: 'selected-app', name: 'Support Bot', mode: 'chat' })],
        page: 1,
        limit: 20,
        has_more: false,
      }),
      'apps.byAppId.get': async () =>
        createAppDetailFixture({
          id: 'selected-app',
          name: 'Support Bot',
          mode: 'chat',
          model_config: createAppModelConfigFixture({
            user_input_form: [
              { 'text-input': { variable: 'topic', label: 'Topic', required: false } },
            ],
          }),
        }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': async () => ({
        data: [],
      }),
    }),
  }
})

const createSchema = (overrides: Partial<ToolFormSchema> = {}): ToolFormSchema => ({
  name: 'field',
  _type: 'string',
  form: 'llm',
  show_on: [],
  variable: 'field',
  type: FormTypeEnum.textInput,
  default: '',
  required: false,
  label: { en_US: 'Field', zh_Hans: '字段' },
  tooltip: { en_US: 'Tooltip', zh_Hans: '提示' },
  scope: 'all',
  url: '',
  input_schema: undefined,
  placeholder: { en_US: 'Placeholder', zh_Hans: '占位符' },
  options: [],
  ...overrides,
})

describe('ReasoningConfigForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the selected parameter schema without changing current form values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Fixture() {
      const [value, setValue] = useState<ReasoningConfigValue>({
        count: { auto: 0, value: { type: VarKindType.constant, value: '3' } },
        config: { auto: 0, value: { type: VarKindType.constant, value: '{}' } },
        records: { auto: 0, value: { type: VarKindType.constant, value: '[]' } },
      })
      return (
        <ReasoningConfigForm
          value={value}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
          schemas={[
            createSchema({
              variable: 'count',
              type: FormTypeEnum.textNumber,
              label: { en_US: 'Count', zh_Hans: '数量' },
            }),
            createSchema({
              variable: 'config',
              type: FormTypeEnum.object,
              label: { en_US: 'Config', zh_Hans: '配置' },
              input_schema: { type: Type.object, properties: { city: { type: Type.string } } },
            }),
            createSchema({
              variable: 'records',
              type: FormTypeEnum.array,
              label: { en_US: 'Records', zh_Hans: '记录' },
              input_schema: {
                type: Type.array,
                items: { type: Type.object, properties: { id: { type: Type.number } } },
              },
            }),
          ]}
          nodeOutputVars={[]}
          availableNodes={[]}
          nodeId="node-1"
        />
      )
    }
    render(<Fixture />)
    const count = screen.getByRole('spinbutton', { name: 'Count' })
    const [configEditor] = screen.getAllByTestId('monaco-editor')
    await user.clear(count)
    await user.type(count, '8')
    fireEvent.change(configEditor!, { target: { value: '{"city":"Shanghai"}' } })
    const previousChanges = onChange.mock.calls.length
    const entries = screen.getAllByRole('button', {
      name: /workflowAgent.nodes.agent.clickToViewParameterSchema/,
    })
    for (const [index, rootName, property] of [
      [0, 'Config', 'city'],
      [1, 'Records', 'id'],
    ] as const) {
      await user.click(entries[index]!)
      const dialog = screen.getByRole('dialog', {
        name: 'workflowAgent.nodes.agent.parameterSchema',
      })
      expect(within(dialog).getByText(rootName)).toBeInTheDocument()
      expect(within(dialog).getByText(property)).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(entries[index]).toHaveFocus()
    }
    expect(screen.getByRole('spinbutton', { name: 'Count' })).toHaveValue(8)
    const editors = screen.getAllByTestId('monaco-editor')
    expect(editors[0]).toHaveValue('{"city":"Shanghai"}')
    expect(editors[1]).toHaveValue('[]')
    expect(onChange).toHaveBeenCalledTimes(previousChanges)
  })

  it('names date parameters from their field title and emits tool storage values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ReasoningConfigForm
        value={{ field: { auto: 0, value: { type: VarKindType.constant, value: '2025-01-15' } } }}
        onChange={onChange}
        schemas={[
          createSchema({
            type: FormTypeEnum.date,
            label: { en_US: 'Departure', zh_Hans: '出发日期' },
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Departure Jan 15, 2025' }))
    await user.click(await screen.findByRole('button', { name: /January 16th, 2025/ }))
    expect(onChange).toHaveBeenCalledWith({
      field: { auto: 0, value: { type: VarKindType.constant, value: '2025-01-16' } },
    })
  })

  it('should toggle automatic values for text fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          field: {
            auto: 0,
            value: { type: VarKindType.mixed, value: 'hello' },
          },
        }}
        onChange={onChange}
        schemas={[createSchema()]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        auto: 1,
        value: null,
      },
    })
  })

  it('should update mixed text and variable types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          count: {
            auto: 0,
            value: { type: VarKindType.constant, value: '1' },
          },
          field: {
            auto: 0,
            value: { type: VarKindType.mixed, value: 'hello' },
          },
        }}
        onChange={onChange}
        schemas={[
          createSchema({ variable: 'field', type: FormTypeEnum.textInput }),
          createSchema({
            variable: 'count',
            type: FormTypeEnum.textNumber,
            default: '5',
            label: { en_US: 'Count', zh_Hans: '数量' },
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    const editor = screen.getByRole('textbox')
    await user.click(editor)
    await user.type(editor, 'updated-text')
    await user.click(
      screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    )

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        field: {
          auto: 0,
          value: { type: VarKindType.mixed, value: 'helloupdated-text' },
        },
      }),
    )
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        count: {
          auto: 0,
          value: { type: VarKindType.variable, value: '' },
        },
      }),
    )
  })

  it('retains the selected app and its edited inputs across reopening', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    function Owner() {
      const [value, setValue] = useState<ReasoningConfigValue>({
        app: {
          auto: 0,
          value: { type: VarKindType.constant, value: null },
        },
        config: {
          auto: 0,
          value: { type: VarKindType.constant, value: '{}' },
        },
      })
      return (
        <ReasoningConfigForm
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
          schemas={[
            createSchema({
              variable: 'config',
              type: FormTypeEnum.object,
              input_schema: { type: Type.object, properties: {}, additionalProperties: false },
              label: { en_US: 'Config', zh_Hans: '配置' },
            }),
            createSchema({
              variable: 'app',
              type: FormTypeEnum.appSelector,
              label: { en_US: 'App', zh_Hans: '应用' },
            }),
          ]}
          nodeOutputVars={[]}
          availableNodes={[]}
          nodeId="node-1"
        />
      )
    }
    render(<Owner />)

    await user.click(screen.getByRole('button', { name: 'app.appSelector.placeholder' }))
    await user.click(screen.getAllByRole('button', { name: 'app.appSelector.placeholder' })[1]!)
    await user.click(await screen.findByRole('option', { name: /Support Bot/ }))
    await user.type(await screen.findByPlaceholderText('Topic'), 'hello')

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        app: {
          auto: 0,
          value: {
            type: undefined,
            value: { app_id: 'selected-app', inputs: { topic: 'hello' }, files: [] },
          },
        },
      }),
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(await screen.findByRole('button', { name: 'Support Bot' }))
    expect(await screen.findByPlaceholderText('Topic')).toHaveValue('hello')
    expect(screen.getAllByRole('button', { name: 'Support Bot' })[1]!).toHaveTextContent(
      'Support Bot',
    )
  })

  it('opens app inputs saved in the legacy direct format', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ReasoningConfigForm
        value={{
          app: {
            auto: 0,
            value: { app_id: 'selected-app', inputs: { topic: 'Saved topic' }, files: [] },
          },
        }}
        onChange={onChange}
        schemas={[createSchema({ variable: 'app', type: FormTypeEnum.appSelector })]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Support Bot' }))
    expect(await screen.findByPlaceholderText('Topic')).toHaveValue('Saved topic')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should merge model selector values into the current field value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          model: {
            auto: 0,
            value: { provider: 'openai' },
          },
        }}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'model',
            type: FormTypeEnum.modelSelector,
            label: { en_US: 'Model', zh_Hans: '模型' },
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^gpt-4.1/ }),
    )

    expect(onChange).toHaveBeenCalledWith({
      model: {
        auto: 0,
        value: {
          provider: 'openai',
          model: 'gpt-4.1',
          model_type: 'llm',
          mode: 'chat',
          completion_params: {},
        },
      },
    })
  })

  it('should update file fields from the variable selector', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          files: {
            auto: 0,
            value: { type: VarKindType.variable, value: [] },
          },
        }}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'files',
            type: FormTypeEnum.files,
            url: 'https://example.com/help',
            label: { en_US: 'Files', zh_Hans: '文件' },
          }),
        ]}
        nodeOutputVars={[
          {
            nodeId: 'node',
            title: 'Files source',
            vars: [{ variable: 'field', type: VarType.arrayFile }],
          },
        ]}
        availableNodes={[
          createNode({ id: 'node', data: { type: BlockEnum.Code, title: 'Files source' } }),
        ]}
        nodeId="node-1"
      />,
    )

    expect(screen.getByRole('link', { name: 'tools.howToGet' })).toHaveAttribute(
      'href',
      'https://example.com/help',
    )
    await user.click(screen.getByRole('button', { name: /workflow.common.setVar/ }))
    await user.click(await screen.findByText('field'))

    expect(onChange).toHaveBeenCalledWith({
      files: {
        auto: 0,
        value: {
          type: VarKindType.variable,
          value: ['node', 'field'],
        },
      },
    })
  })

  it('should update number, boolean, and select fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          count: {
            auto: 0,
            value: { type: VarKindType.constant, value: '' },
          },
          enabled: {
            auto: 0,
            value: { type: VarKindType.constant, value: false },
          },
          choice: {
            auto: 0,
            value: { type: VarKindType.constant, value: '' },
          },
        }}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'count',
            type: FormTypeEnum.textNumber,
            label: { en_US: 'Count', zh_Hans: '数量' },
            placeholder: { en_US: 'Enter count', zh_Hans: '输入数量' },
          }),
          createSchema({
            variable: 'enabled',
            type: FormTypeEnum.checkbox,
            label: { en_US: 'Enabled', zh_Hans: '启用' },
          }),
          createSchema({
            variable: 'choice',
            type: FormTypeEnum.select,
            label: { en_US: 'Choice', zh_Hans: '选择' },
            placeholder: { en_US: 'Pick one', zh_Hans: '选择一个' },
            options: [
              {
                value: 'alpha',
                label: { en_US: 'Alpha', zh_Hans: 'Alpha' },
                show_on: [],
              },
              {
                value: 'beta',
                label: { en_US: 'Beta', zh_Hans: 'Beta' },
                show_on: [],
              },
            ],
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    expect(screen.getByText('Pick one')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter count')).toBeInTheDocument()

    await user.type(screen.getByRole('spinbutton'), '7')
    await user.click(screen.getByRole('button', { name: 'True' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Beta' }))

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        count: {
          auto: 0,
          value: { type: VarKindType.constant, value: '7' },
        },
      }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        enabled: {
          auto: 0,
          value: { type: VarKindType.constant, value: true },
        },
      }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        choice: {
          auto: 0,
          value: { type: VarKindType.constant, value: 'beta' },
        },
      }),
    )
  })

  it('should render selected select values and update object json fields', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          config: {
            auto: 0,
            value: { type: VarKindType.constant, value: '{}' },
          },
          choice: {
            auto: 0,
            value: { type: VarKindType.constant, value: 'alpha' },
          },
        }}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'config',
            type: FormTypeEnum.object,
            input_schema: { type: Type.object, properties: {}, additionalProperties: false },
            placeholder: { en_US: '{\n  "foo": "bar"\n}', zh_Hans: '{\n  "foo": "bar"\n}' },
          }),
          createSchema({
            variable: 'choice',
            type: FormTypeEnum.select,
            placeholder: { en_US: 'Pick one', zh_Hans: '选择一个' },
            options: [
              {
                value: 'alpha',
                label: { en_US: 'Alpha', zh_Hans: 'Alpha' },
                show_on: [],
              },
              {
                value: 'beta',
                label: { en_US: 'Beta', zh_Hans: 'Beta' },
                show_on: [],
              },
            ],
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0)
    expect(screen.getByTestId('monaco-editor')).toHaveValue('{}')

    fireEvent.change(screen.getByTestId('monaco-editor'), { target: { value: '{"foo":"bar"}' } })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          auto: 0,
          value: { type: VarKindType.constant, value: '{"foo":"bar"}' },
        },
      }),
    )
  })
})
