import type { ReactNode } from 'react'
import type { AppSelectorValue } from '@/app/components/plugins/plugin-detail-panel/app-selector'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import ReasoningConfigForm from '../reasoning-config-form'

vi.mock('@/app/components/base/input', () => ({
  default: ({ value, onChange, placeholder }: { value?: string, onChange: (e: { target: { value: string } }) => void, placeholder?: string }) => (
    <input data-testid="number-input" placeholder={placeholder} value={value} onChange={e => onChange({ target: { value: e.target.value } })} />
  ),
}))

vi.mock('@langgenius/dify-ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
  }>({})

  return {
    Select: ({ children, onValueChange }: {
      children: React.ReactNode
      onValueChange?: (value: string) => void
    }) => (
      <SelectContext.Provider value={{ onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: { children: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode, value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button key={value} data-testid={`select-${value}`} type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectItemText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItemIndicator: () => null,
  }
})

vi.mock('@langgenius/dify-ui/switch', () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean, onCheckedChange: (checked: boolean) => void }) => (
    <button data-testid="auto-switch" onClick={() => onCheckedChange(!checked)}>
      {checked ? 'on' : 'off'}
    </button>
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector', () => ({
  AppSelector: ({ onSelect, scope }: { onSelect: (value: AppSelectorValue) => void, scope?: string }) => (
    <button
      data-testid="app-selector"
      data-scope={scope}
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

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ onChange, placeholder }: { onChange: (value: string) => void, placeholder?: ReactNode }) => (
    <div>
      <div data-testid="code-editor-placeholder">{placeholder}</div>
      <button data-testid="code-editor" onClick={() => onChange('{"foo":"bar"}')}>
        Update JSON
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/form-input-boolean', () => ({
  default: ({ onChange }: { onChange: (value: boolean) => void }) => (
    <button data-testid="boolean-input" onClick={() => onChange(true)}>
      Set Boolean
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/form-input-type-switch', () => ({
  default: ({ onChange }: { onChange: (value: VarKindType) => void }) => (
    <button data-testid="type-switch" onClick={() => onChange(VarKindType.variable)}>
      Switch Type
    </button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange, value }: { onChange: (value: string) => void, value: string | string[] }) => (
    <button data-testid="var-picker" data-value={JSON.stringify(value)} onClick={() => onChange(['node', 'field'] as unknown as string)}>
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

vi.mock('../schema-modal', () => ({
  default: ({ isShow, rootName, onClose }: { isShow: boolean, rootName: string, onClose: () => void }) => (
    isShow
      ? (
          <div data-testid="schema-modal">
            <span>{rootName}</span>
            <button data-testid="close-schema" onClick={onClose}>Close</button>
          </div>
        )
      : null
  ),
}))

const createSchema = (overrides: Partial<ToolFormSchema> = {}): ToolFormSchema => ({
  variable: 'field',
  type: FormTypeEnum.textInput,
  default: '',
  required: false,
  label: { en_US: 'Field', zh_Hans: '字段' },
  tooltip: { en_US: 'Tooltip', zh_Hans: '提示' },
  scope: 'all',
  url: '',
  input_schema: {},
  placeholder: { en_US: 'Placeholder', zh_Hans: '占位符' },
  options: [],
  ...overrides,
} as ToolFormSchema)

describe('ReasoningConfigForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    fireEvent.click(screen.getByTestId('auto-switch'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        auto: 1,
        value: null,
      },
    })
  })

  it('should update mixed text and variable types', () => {
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
          createSchema({ variable: 'count', type: FormTypeEnum.textNumber, default: '5', label: { en_US: 'Count', zh_Hans: '数量' } }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    fireEvent.click(screen.getByTestId('mixed-input'))
    fireEvent.click(screen.getByTestId('type-switch'))

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      field: {
        auto: 0,
        value: { type: VarKindType.mixed, value: 'updated-text' },
      },
    }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      count: {
        auto: 0,
        value: { type: VarKindType.variable, value: '' },
      },
    }))
  })

  it('should open schema modal for object fields and support app selection', () => {
    const onChange = vi.fn()

    const { container } = render(
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

    fireEvent.click(container.querySelector('div.ml-0\\.5.cursor-pointer')!)
    expect(screen.getByTestId('schema-modal')).toHaveTextContent('Config')
    fireEvent.click(screen.getByTestId('close-schema'))

    fireEvent.click(screen.getByTestId('app-selector'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      app: {
        auto: 0,
        value: {
          type: undefined,
          value: { app_id: 'app-1', inputs: { topic: 'hello' }, files: [] },
        },
      },
    }))
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
            label: { en_US: 'Files', zh_Hans: '文件' },
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
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

  it('should update number, boolean, and select fields', () => {
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

    fireEvent.change(screen.getByTestId('number-input'), { target: { value: '7' } })
    fireEvent.click(screen.getByTestId('boolean-input'))
    fireEvent.click(screen.getByTestId('select-beta'))

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      count: {
        auto: 0,
        value: { type: VarKindType.constant, value: '7' },
      },
    }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      enabled: {
        auto: 0,
        value: { type: VarKindType.constant, value: true },
      },
    }))
    expect(onChange).toHaveBeenNthCalledWith(3, expect.objectContaining({
      choice: {
        auto: 0,
        value: { type: VarKindType.constant, value: 'beta' },
      },
    }))
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
    expect(screen.getByTestId('code-editor-placeholder')).toHaveTextContent('"foo": "bar"')

    fireEvent.click(screen.getByTestId('code-editor'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        auto: 0,
        value: { type: VarKindType.constant, value: '{"foo":"bar"}' },
      },
    }))
  })

  it('should render json placeholders, default app scope, variable links, and helper urls', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={{
          config: {
            auto: 0,
            value: { type: VarKindType.constant, value: '{}' },
          },
          app: {
            auto: 0,
            value: { type: VarKindType.constant, value: null },
          },
          files: {
            auto: 0,
            value: { type: VarKindType.variable, value: '' },
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
            variable: 'app',
            type: FormTypeEnum.appSelector,
            scope: '' as never,
          }),
          createSchema({
            variable: 'files',
            type: FormTypeEnum.files,
            url: 'https://example.com/help',
          }),
        ]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    expect(screen.getByTestId('code-editor-placeholder')).toHaveTextContent('"foo": "bar"')
    expect(screen.getByTestId('app-selector')).toHaveAttribute('data-scope', 'all')
    expect(screen.getByTestId('var-picker')).toHaveAttribute('data-value', '[]')
    expect(screen.getByRole('link', { name: 'tools.howToGet' })).toHaveAttribute('href', 'https://example.com/help')
  })
})
