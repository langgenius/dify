import type { ReasoningConfigValue } from '../reasoning-config-form'
import type { AppSelectorValue } from '@/app/components/plugins/plugin-detail-panel/app-selector'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { ReasoningConfigForm } from '../reasoning-config-form'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector', () => ({
  AppSelector: ({ onSelect }: { onSelect: (value: AppSelectorValue) => void }) => (
    <button
      data-testid="app-selector"
      onClick={() => onSelect({ app_id: 'app-1', inputs: { topic: 'hello' }, files: [] })}
    >
      Select App
    </button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/model-selector', () => ({
  default: ({ setModel }: { setModel: (value: Record<string, unknown>) => void }) => (
    <button data-testid="model-selector" onClick={() => setModel({ model: 'gpt-4.1' })}>
      Select Model
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button data-testid="var-picker" onClick={() => onChange(['node', 'field'])}>
      Pick Variable
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/tool/components/mixed-variable-text-input', () => ({
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button data-testid="mixed-input" onClick={() => onChange('updated-text')}>
      Update Text
    </button>
  ),
}))

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

  it('should toggle automatic values for text fields', () => {
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

    fireEvent.click(screen.getByRole('switch'))

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

    fireEvent.click(screen.getByTestId('mixed-input'))
    await user.click(
      screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' }),
    )

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        field: {
          auto: 0,
          value: { type: VarKindType.mixed, value: 'updated-text' },
        },
      }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        count: {
          auto: 0,
          value: { type: VarKindType.variable, value: '' },
        },
      }),
    )
  })

  it('stores the selected app configuration', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          app: {
            auto: 0,
            value: { type: VarKindType.constant, value: null },
          },
          config: {
            auto: 0,
            value: { type: VarKindType.constant, value: '{}' },
          },
        }}
        onChange={onChange}
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
      />,
    )

    fireEvent.click(screen.getByTestId('app-selector'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        app: {
          auto: 0,
          value: {
            type: undefined,
            value: { app_id: 'app-1', inputs: { topic: 'hello' }, files: [] },
          },
        },
      }),
    )
  })

  it('should merge model selector values into the current field value', () => {
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

    fireEvent.click(screen.getByTestId('model-selector'))

    expect(onChange).toHaveBeenCalledWith({
      model: {
        auto: 0,
        value: {
          provider: 'openai',
          model: 'gpt-4.1',
        },
      },
    })
  })

  it('should update file fields from the variable selector', () => {
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
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    expect(screen.getByRole('link', { name: 'tools.howToGet' })).toHaveAttribute(
      'href',
      'https://example.com/help',
    )
    fireEvent.click(screen.getByTestId('var-picker'))

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

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
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
