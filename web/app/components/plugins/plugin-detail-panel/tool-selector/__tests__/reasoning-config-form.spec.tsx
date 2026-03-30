import type { ReactNode } from 'react'
import type { Node } from 'reactflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'
import ReasoningConfigForm from '../reasoning-config-form'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode
    onValueChange: (value: string) => void
    value?: string
  }) => (
    <div data-testid="select-root" data-value={value}>
      {children}
      <button onClick={() => onValueChange('selected-option')}>Choose Select Option</button>
    </div>
  ),
  SelectTrigger: ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={className}>{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? 'Select'}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode, value: string }) => <div data-testid={`select-item-${value}`}>{children}</div>,
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    className,
    onClick,
  }: {
    children: ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <button
      type="button"
      data-testid={className?.includes('cursor-pointer') ? 'schema-trigger' : 'tooltip-trigger'}
      className={className}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector', () => ({
  default: ({
    onSelect,
  }: {
    onSelect: (value: { app_id: string, inputs: Record<string, unknown>, files?: unknown[] }) => void
  }) => <button onClick={() => onSelect({ app_id: 'app-1', inputs: { query: 'hello' } })}>Select App</button>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/model-selector', () => ({
  default: ({
    setModel,
  }: {
    setModel: (value: Record<string, unknown>) => void
  }) => <button onClick={() => setModel({ model: 'gpt-4o-mini' })}>Select Model</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({
    onChange,
  }: {
    onChange: (value: unknown) => void
  }) => <button onClick={() => onChange({ from: 'editor' })}>Update JSON</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/form-input-boolean', () => ({
  default: ({
    value,
    onChange,
  }: {
    value?: boolean
    onChange: (value: boolean) => void
  }) => <button onClick={() => onChange(!value)}>Toggle Boolean</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/form-input-type-switch', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: VarKindType) => void
  }) => (
    <div data-testid="type-switch">
      <span>{value}</span>
      <button onClick={() => onChange(VarKindType.variable)}>Switch To Variable</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({
    onChange,
    filterVar,
    valueTypePlaceHolder,
  }: {
    onChange: (value: string[]) => void
    filterVar?: (value: { type: string }) => boolean
    valueTypePlaceHolder?: string
  }) => {
    const matchesFilter = filterVar?.({ type: valueTypePlaceHolder ?? 'unknown' }) ?? false
    return (
      <div data-testid={`var-picker-${String(valueTypePlaceHolder)}`}>
        <span>{`matches-filter:${String(matchesFilter)}`}</span>
        <button onClick={() => onChange(['node-1', 'var-1'])}>Select Variable</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/tool/components/mixed-variable-text-input', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <div data-testid="mixed-variable-text-input">
      <span>{value}</span>
      <button onClick={() => onChange('mixed-updated')}>Update Mixed Text</button>
    </div>
  ),
}))

vi.mock('../schema-modal', () => ({
  default: ({
    isShow,
    rootName,
    onClose,
  }: {
    isShow: boolean
    rootName: string
    onClose: () => void
  }) => (
    isShow
      ? (
          <div data-testid="schema-modal">
            <span>{rootName}</span>
            <button onClick={onClose}>Close Schema</button>
          </div>
        )
      : null
  ),
}))

const availableNodes: Node[] = []

const createSchema = (overrides: Record<string, unknown>) => ({
  default: '',
  variable: 'field',
  label: { en_US: 'Field' },
  required: false,
  tooltip: { en_US: 'Helpful tooltip' },
  type: FormTypeEnum.textInput,
  scope: 'all',
  url: undefined,
  input_schema: undefined,
  placeholder: { en_US: 'Enter value' },
  options: [],
  ...overrides,
})

const createValue = (value: Record<string, unknown>) => value

describe('ReasoningConfigForm', () => {
  it('should render mixed text input and support auto mode toggling when variable reference is allowed', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={createValue({
          prompt: { auto: 0, value: { type: VarKindType.mixed, value: 'hello' } },
        })}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'prompt',
            label: { en_US: 'Prompt' },
            type: FormTypeEnum.textInput,
          }),
        ]}
        nodeId="node-1"
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByTestId('mixed-variable-text-input')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update Mixed Text' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: {
        auto: 0,
        value: {
          type: VarKindType.mixed,
          value: 'mixed-updated',
        },
      },
    }))

    fireEvent.click(screen.getByText('plugin.detailPanel.toolSelector.auto'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: {
        auto: 1,
        value: null,
      },
    }))
  })

  it('should use plain input when variable reference is disabled', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={createValue({
          plain_text: { auto: 0, value: { type: VarKindType.mixed, value: 'before' } },
        })}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'plain_text',
            label: { en_US: 'Plain Text' },
            type: FormTypeEnum.secretInput,
            placeholder: { en_US: 'Enter prompt' },
          }),
        ]}
        disableVariableReference
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Enter prompt'), { target: { value: 'after' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      plain_text: {
        auto: 0,
        value: {
          type: VarKindType.mixed,
          value: 'after',
        },
      },
    }))
  })

  it('should update typed fields, selectors, and variable references across supported schema types', () => {
    const onChange = vi.fn()
    const enabledValue = { auto: 0, value: { type: VarKindType.constant, value: false } }

    render(
      <ReasoningConfigForm
        value={createValue({
          count: { auto: 0, value: { type: VarKindType.constant, value: '2' } },
          enabled: enabledValue,
          mode: { auto: 0, value: { type: VarKindType.constant, value: 'draft' } },
          assistant: { value: null, auto: 0 },
          model: { value: { provider: 'openai' }, auto: 0 },
          attachments: { auto: 0, value: { type: VarKindType.variable, value: [] } },
        })}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'count',
            label: { en_US: 'Count' },
            type: FormTypeEnum.textNumber,
            placeholder: { en_US: 'Enter number' },
          }),
          createSchema({
            variable: 'enabled',
            label: { en_US: 'Enabled' },
            type: FormTypeEnum.checkbox,
          }),
          createSchema({
            variable: 'mode',
            label: { en_US: 'Mode' },
            type: FormTypeEnum.select,
            options: [
              {
                value: 'selected-option',
                label: { en_US: 'Selected Option' },
                show_on: [{ variable: 'enabled', value: enabledValue }],
              },
            ],
          }),
          createSchema({
            variable: 'assistant',
            label: { en_US: 'Assistant' },
            type: FormTypeEnum.appSelector,
          }),
          createSchema({
            variable: 'model',
            label: { en_US: 'Model' },
            type: FormTypeEnum.modelSelector,
          }),
          createSchema({
            variable: 'attachments',
            label: { en_US: 'Attachments' },
            type: FormTypeEnum.files,
          }),
        ]}
        nodeId="node-2"
        availableNodes={availableNodes}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Enter number'), { target: { value: '3' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      count: {
        auto: 0,
        value: {
          type: VarKindType.constant,
          value: '3',
        },
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Switch To Variable' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      count: {
        auto: 0,
        value: {
          type: VarKindType.variable,
          value: '',
        },
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Boolean' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: {
        auto: 0,
        value: {
          type: VarKindType.constant,
          value: true,
        },
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Choose Select Option' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: {
        auto: 0,
        value: {
          type: VarKindType.constant,
          value: 'selected-option',
        },
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Select App' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      assistant: expect.objectContaining({
        value: {
          app_id: 'app-1',
          inputs: { query: 'hello' },
        },
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Select Model' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      model: expect.objectContaining({
        value: {
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Select Variable' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      attachments: {
        auto: 0,
        value: {
          type: VarKindType.variable,
          value: ['node-1', 'var-1'],
        },
      },
    }))

    expect(screen.getAllByText('plugin.detailPanel.toolSelector.auto').length).toBeGreaterThan(0)
  })

  it('should toggle file auto mode through the switch control', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={createValue({
          file_input: { auto: 0, value: { type: VarKindType.variable, value: [] } },
        })}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'file_input',
            label: { en_US: 'File Input' },
            type: FormTypeEnum.file,
          }),
        ]}
        nodeId="node-5"
        availableNodes={availableNodes}
      />,
    )

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      file_input: {
        auto: 1,
        value: null,
      },
    }))
  })

  it('should compute variable filters for number, string, boolean, object, array, and files selectors', () => {
    render(
      <ReasoningConfigForm
        value={createValue({
          string_var: { auto: 0, value: { type: VarKindType.variable, value: [] } },
          number_var: { auto: 0, value: { type: VarKindType.variable, value: [] } },
          boolean_var: { auto: 0, value: { type: VarKindType.variable, value: [] } },
          object_var: { auto: 0, value: { type: VarKindType.variable, value: [] } },
          array_var: { auto: 0, value: { type: VarKindType.variable, value: [] } },
          files_var: { auto: 0, value: { type: VarKindType.variable, value: [] } },
        })}
        onChange={vi.fn()}
        schemas={[
          createSchema({ variable: 'string_var', label: { en_US: 'String Var' }, type: FormTypeEnum.textInput }),
          createSchema({ variable: 'number_var', label: { en_US: 'Number Var' }, type: FormTypeEnum.textNumber }),
          createSchema({ variable: 'boolean_var', label: { en_US: 'Boolean Var' }, type: FormTypeEnum.checkbox }),
          createSchema({ variable: 'object_var', label: { en_US: 'Object Var' }, type: FormTypeEnum.object }),
          createSchema({ variable: 'array_var', label: { en_US: 'Array Var' }, type: FormTypeEnum.array }),
          createSchema({ variable: 'files_var', label: { en_US: 'Files Var' }, type: FormTypeEnum.files }),
        ]}
        nodeId="node-6"
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByTestId(`var-picker-${VarType.string}`)).toHaveTextContent('matches-filter:true')
    expect(screen.getByTestId(`var-picker-${VarType.number}`)).toHaveTextContent('matches-filter:true')
    expect(screen.getByTestId(`var-picker-${VarType.boolean}`)).toHaveTextContent('matches-filter:true')
    expect(screen.getByTestId(`var-picker-${VarType.object}`)).toHaveTextContent('matches-filter:true')
    expect(screen.getByTestId(`var-picker-${VarType.arrayObject}`)).toHaveTextContent('matches-filter:true')
    expect(screen.getByTestId(`var-picker-${VarType.arrayFile}`)).toHaveTextContent('matches-filter:true')
  })

  it('should render json editor, schema modal, and help link for structured schemas', () => {
    const onChange = vi.fn()

    render(
      <ReasoningConfigForm
        value={createValue({
          payload: {
            auto: 0,
            value: {
              type: VarKindType.constant,
              value: { answer: '42' },
            },
          },
        })}
        onChange={onChange}
        schemas={[
          createSchema({
            variable: 'payload',
            label: { en_US: 'Payload' },
            type: FormTypeEnum.object,
            input_schema: { type: 'object', properties: {} },
            url: 'https://example.com/docs',
            placeholder: { en_US: 'Enter JSON' },
          }),
        ]}
        nodeId="node-3"
        availableNodes={availableNodes}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Update JSON' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: {
        auto: 0,
        value: {
          type: VarKindType.constant,
          value: { from: 'editor' },
        },
      },
    }))

    fireEvent.click(screen.getByTestId('schema-trigger'))
    expect(screen.getByTestId('schema-modal')).toHaveTextContent('Payload')

    fireEvent.click(screen.getByRole('button', { name: 'Close Schema' }))
    expect(screen.queryByTestId('schema-modal')).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'tools.howToGet' })).toHaveAttribute('href', 'https://example.com/docs')
  })

  it('should hide auto toggle for model selector schemas', () => {
    render(
      <ReasoningConfigForm
        value={createValue({
          model_only: { value: { provider: 'openai' }, auto: 0 },
        })}
        onChange={vi.fn()}
        schemas={[
          createSchema({
            variable: 'model_only',
            label: { en_US: 'Model Only' },
            type: FormTypeEnum.modelSelector,
          }),
        ]}
        nodeId="node-4"
        availableNodes={availableNodes}
      />,
    )

    expect(screen.queryByText('plugin.detailPanel.toolSelector.auto')).not.toBeInTheDocument()
  })
})
