import type { ComponentProps } from 'react'
import type { CredentialFormSchema, FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { AppSelectorValue } from '@/app/components/plugins/plugin-detail-panel/app-selector'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '../../types'
import FormInputItem from '../form-input-item'

const {
  mockFetchDynamicOptions,
  mockTriggerDynamicOptionsState,
} = vi.hoisted(() => ({
  mockFetchDynamicOptions: vi.fn(),
  mockTriggerDynamicOptionsState: {
    data: undefined as { options: FormOption[] } | undefined,
    isLoading: false,
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchDynamicOptions: () => ({
    mutateAsync: mockFetchDynamicOptions,
  }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => mockTriggerDynamicOptionsState,
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => false,
  useWorkflow: () => ({
    getTreeLeafNodes: () => [],
    getNodeById: () => undefined,
    getBeforeNodesInSameBranchIncludeParent: () => [],
  }),
  useWorkflowVariables: () => ({
    getNodeAvailableVars: () => [],
  }),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector', () => ({
  AppSelector: ({ onSelect }: { onSelect: (value: AppSelectorValue) => void }) => (
    <button onClick={() => onSelect({ app_id: 'app-1', inputs: {}, files: [] })}>app-selector</button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/model-selector', () => ({
  default: ({ setModel }: { setModel: (value: string) => void }) => (
    <button onClick={() => setModel('model-1')}>model-selector</button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/tool/components/mixed-variable-text-input', () => ({
  default: ({ onChange, value }: { onChange: (value: string) => void, value: string }) => (
    <input aria-label="mixed-variable-input" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ onChange, value }: { onChange: (value: string) => void, value: string }) => (
    <textarea aria-label="json-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button onClick={() => onChange(['node-2', 'asset'])}>variable-picker</button>
  ),
}))

const createSchema = (
  overrides: Partial<CredentialFormSchema & {
    _type?: FormTypeEnum
    multiple?: boolean
    options?: FormOption[]
  }> = {},
) => ({
  label: { en_US: 'Field', zh_Hans: '字段' },
  name: 'field',
  required: false,
  show_on: [],
  type: FormTypeEnum.textInput,
  variable: 'field',
  ...overrides,
}) as CredentialFormSchema & {
  _type?: FormTypeEnum
  multiple?: boolean
  options?: FormOption[]
}

const createOption = (
  value: string,
  overrides: Partial<FormOption> = {},
): FormOption => ({
  label: { en_US: value, zh_Hans: value },
  show_on: [],
  value,
  ...overrides,
})

const renderFormInputItem = (props: Partial<ComponentProps<typeof FormInputItem>> = {}) => {
  const onChange = vi.fn()
  const result = renderWorkflowFlowComponent(
    <FormInputItem
      readOnly={false}
      nodeId="node-1"
      schema={createSchema()}
      value={{
        field: {
          type: VarKindType.constant,
          value: '',
        },
      }}
      onChange={onChange}
      {...props}
    />,
    {
      edges: [],
      hooksStoreProps: {},
      nodes: [],
    },
  )

  return { ...result, onChange }
}

describe('FormInputItem branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchDynamicOptions.mockResolvedValue({ options: [] })
    mockTriggerDynamicOptionsState.data = undefined
    mockTriggerDynamicOptionsState.isLoading = false
  })

  it('should update mixed string inputs via the shared text input', () => {
    const { onChange } = renderFormInputItem()

    fireEvent.change(screen.getByLabelText('mixed-variable-input'), { target: { value: 'hello world' } })

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.mixed,
        value: 'hello world',
      },
    })
  })

  it('should switch from variable mode back to constant mode with the schema default value', () => {
    const { container, onChange } = renderFormInputItem({
      schema: createSchema({
        default: 7 as never,
        type: FormTypeEnum.textNumber,
      }),
      value: {
        field: {
          type: VarKindType.variable,
          value: ['node-1', 'count'],
        },
      },
    })

    const switchRoot = container.querySelector('.inline-flex.h-8.shrink-0.gap-px')
    const clickableItems = switchRoot?.querySelectorAll('.cursor-pointer') ?? []
    fireEvent.click(clickableItems[1] as HTMLElement)

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: 7,
      },
    })
  })

  it('should render static select options with icons and update the selected item', () => {
    const { onChange } = renderFormInputItem({
      schema: createSchema({
        type: FormTypeEnum.select,
        options: [
          createOption('basic', { icon: '/basic.svg' }),
          createOption('pro'),
        ],
      }),
      value: {
        field: {
          type: VarKindType.constant,
          value: '',
        },
      },
    })

    fireEvent.click(screen.getByRole('combobox'))
    expect(document.querySelector('img[src="/basic.svg"]')).toBeInTheDocument()
    fireEvent.click(screen.getByText('basic'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: 'basic',
      },
    })
  })

  it('should render static multi-select values and update selected labels', () => {
    const { onChange } = renderFormInputItem({
      schema: createSchema({
        multiple: true,
        type: FormTypeEnum.select,
        options: [
          createOption('alpha'),
          createOption('beta'),
        ],
      }),
      value: {
        field: {
          type: VarKindType.constant,
          value: ['alpha'],
        },
      },
    })

    expect(screen.getByText('alpha')).toBeInTheDocument()
    fireEvent.click(screen.getByText('alpha').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByText('beta'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: ['alpha', 'beta'],
      },
    })
  })

  it('should fetch tool dynamic options, render them, and update the value', async () => {
    mockFetchDynamicOptions.mockResolvedValueOnce({
      options: [
        createOption('remote', { icon: '/remote.svg' }),
      ],
    })
    const { onChange } = renderFormInputItem({
      schema: createSchema({
        type: FormTypeEnum.dynamicSelect,
      }),
      currentProvider: { plugin_id: 'provider-1', name: 'provider-1' } as never,
      currentTool: { name: 'tool-1' } as never,
      providerType: PluginCategoryEnum.tool,
      value: {
        field: {
          type: VarKindType.constant,
          value: '',
        },
      },
    })

    await waitFor(() => {
      expect(mockFetchDynamicOptions).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('combobox'))
    expect(document.querySelector('img[src="/remote.svg"]')).toBeInTheDocument()
    fireEvent.click(screen.getByText('remote'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: 'remote',
      },
    })
  })

  it('should recover when fetching dynamic tool options fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchDynamicOptions.mockRejectedValueOnce(new Error('network'))

    renderFormInputItem({
      schema: createSchema({
        type: FormTypeEnum.dynamicSelect,
      }),
      currentProvider: { plugin_id: 'provider-1', name: 'provider-1' } as never,
      currentTool: { name: 'tool-1' } as never,
      providerType: PluginCategoryEnum.tool,
    })

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled()
    })

    consoleSpy.mockRestore()
  })

  it('should use trigger dynamic options for multi-select values', async () => {
    mockTriggerDynamicOptionsState.data = {
      options: [
        createOption('trigger-option'),
      ],
    }

    const { onChange } = renderFormInputItem({
      schema: createSchema({
        multiple: true,
        type: FormTypeEnum.dynamicSelect,
      }),
      currentProvider: { plugin_id: 'provider-2', name: 'provider-2', credential_id: 'credential-1' } as never,
      currentTool: { name: 'trigger-tool' } as never,
      providerType: PluginCategoryEnum.trigger,
      value: {
        field: {
          type: VarKindType.constant,
          value: [],
        },
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Select options').closest('button')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByText('Select options').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByText('trigger-option'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: ['trigger-option'],
      },
    })
  })

  it('should delegate app and model selection to their dedicated controls', () => {
    const app = renderFormInputItem({
      schema: createSchema({ type: FormTypeEnum.appSelector }),
    })
    fireEvent.click(screen.getByText('app-selector'))
    expect(app.onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: {
          app_id: 'app-1',
          inputs: {},
          files: [],
        },
      },
    })

    app.unmount()

    const model = renderFormInputItem({
      schema: createSchema({ type: FormTypeEnum.modelSelector }),
    })
    fireEvent.click(screen.getByText('model-selector'))
    expect(model.onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: 'model-1',
      },
    })
  })

  it('should render the JSON editor and variable picker specialized branches', () => {
    const json = renderFormInputItem({
      schema: createSchema({ type: FormTypeEnum.object }),
      value: {
        field: {
          type: VarKindType.constant,
          value: '{"enabled":false}',
        },
      },
    })

    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"enabled":true}' } })
    expect(json.onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: '{"enabled":true}',
      },
    })

    json.unmount()

    const picker = renderFormInputItem({
      schema: createSchema({ type: FormTypeEnum.file }),
      value: {
        field: {
          type: VarKindType.constant,
          value: '',
        },
      },
    })

    fireEvent.click(screen.getByText('variable-picker'))
    expect(picker.onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.variable,
        value: ['node-2', 'asset'],
      },
    })
  })

  it('should render variable selectors for boolean variable inputs', () => {
    const { onChange } = renderFormInputItem({
      schema: createSchema({
        _type: FormTypeEnum.boolean,
        type: FormTypeEnum.textInput,
      }),
      value: {
        field: {
          type: VarKindType.variable,
          value: ['node-3', 'flag'],
        },
      },
    })

    fireEvent.click(screen.getByText('variable-picker'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.variable,
        value: ['node-2', 'asset'],
      },
    })
  })
})
