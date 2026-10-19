import type { ComponentProps } from 'react'
import type {
  CredentialFormSchema,
  FormOption,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { VarKindType } from '../../types'
import FormInputItem from '../form-input-item'

const createSchema = (
  overrides: Partial<
    CredentialFormSchema & {
      _type?: FormTypeEnum
      multiple?: boolean
      options?: FormOption[]
    }
  > = {},
) =>
  ({
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

const createOption = (value: string, overrides: Partial<FormOption> = {}): FormOption => ({
  label: { en_US: value, zh_Hans: value },
  show_on: [],
  value,
  ...overrides,
})

const renderFormInputItem = (props: Partial<ComponentProps<typeof FormInputItem>> = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState<ComponentProps<typeof FormInputItem>['value']>(
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
          onChange(next)
          setValue(next)
        }}
      />
    )
  }
  renderWorkflowFlowComponent(<Harness />, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    nodes: [createNode({ id: 'node-1' })],
    edges: [],
  })

  return { onChange }
}

describe('FormInputItem', () => {
  it('shows a schema-provided numeric string and prevents edits in readonly mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderFormInputItem({
      readOnly: true,
      schema: createSchema({ type: FormTypeEnum.textNumber }),
      value: { field: { type: VarKindType.constant, value: '3.5' } },
    })
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('3.5')
    expect(input).toHaveAttribute('readonly')
    await user.type(input, '9{ArrowUp}')
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('3.5')
  })

  it('should store a numeric constant and clear it without producing NaN', async () => {
    const user = userEvent.setup()
    const { onChange } = renderFormInputItem({
      schema: createSchema({ type: FormTypeEnum.textNumber }),
      value: {
        field: {
          type: VarKindType.constant,
          value: 1,
        },
      },
    })

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '3.5')

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: 3.5,
      },
    })
    await user.clear(input)
    expect(onChange).toHaveBeenLastCalledWith({
      field: { type: VarKindType.constant, value: null },
    })
  })

  it('should toggle boolean fields using the shared boolean input', () => {
    const { onChange } = renderFormInputItem({
      schema: createSchema({
        _type: FormTypeEnum.boolean,
        type: FormTypeEnum.checkbox,
      }),
      value: {
        field: {
          type: VarKindType.constant,
          value: true,
        },
      },
    })

    fireEvent.click(screen.getByText('False'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: false,
      },
    })
  })

  it('should filter checkbox options by show_on and update selected values', () => {
    const { onChange } = renderFormInputItem({
      schema: createSchema({
        _type: FormTypeEnum.checkbox,
        options: [
          createOption('basic'),
          createOption('pro', {
            show_on: [{ variable: 'mode', value: 'pro' }],
          }),
        ],
        type: FormTypeEnum.checkbox,
      }),
      value: {
        field: {
          type: VarKindType.constant,
          value: ['basic'],
        },
        mode: {
          type: VarKindType.constant,
          value: 'pro',
        },
      },
    })

    fireEvent.click(screen.getByText('pro'))

    expect(onChange).toHaveBeenCalledWith({
      field: {
        type: VarKindType.constant,
        value: ['basic', 'pro'],
      },
      mode: {
        type: VarKindType.constant,
        value: 'pro',
      },
    })
  })
})

it.each([false, 0])(
  'retains the static schema default %s when switching a variable to a constant',
  (defaultValue) => {
    const { onChange } = renderFormInputItem({
      staticSchema: true,
      schema: {
        ...createSchema({
          type: typeof defaultValue === 'number' ? FormTypeEnum.textNumber : FormTypeEnum.checkbox,
          _type: typeof defaultValue === 'number' ? FormTypeEnum.textNumber : FormTypeEnum.boolean,
        }),
        default: defaultValue,
      },
      value: { field: { type: VarKindType.variable, value: ['upstream', 'value'] } },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.input' }))
    expect(onChange).toHaveBeenCalledWith({
      field: { type: VarKindType.constant, value: defaultValue },
    })
  },
)

it('prevents boolean edits and switching input kind in readonly mode', async () => {
  const user = userEvent.setup()
  const { onChange } = renderFormInputItem({
    readOnly: true,
    schema: createSchema({ _type: FormTypeEnum.boolean, type: FormTypeEnum.checkbox }),
    value: { field: { type: VarKindType.constant, value: true } },
  })
  const falseButton = screen.getByRole('button', { name: 'False' })
  const variable = screen.getByRole('radio', { name: 'workflow.nodes.common.typeSwitch.variable' })
  expect(falseButton).toBeDisabled()
  expect(variable).toBeDisabled()
  await user.click(falseButton)
  await user.click(variable)
  expect(onChange).not.toHaveBeenCalled()
})
