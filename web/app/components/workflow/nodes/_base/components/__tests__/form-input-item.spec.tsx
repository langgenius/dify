import type { ComponentProps } from 'react'
import type {
  CredentialFormSchema,
  FormOption,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '../../types'
import FormInputItem from '../form-input-item'

vi.mock('../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow')>()

  return {
    ...actual,
    useIsChatMode: () => false,
    useWorkflow: () => ({
      getTreeLeafNodes: () => [],
      getNodeById: () => undefined,
      getBeforeNodesInSameBranchIncludeParent: () => [],
    }),
  }
})

vi.mock('../../../../hooks/use-workflow-variables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow-variables')>()

  return {
    ...actual,
    useWorkflowVariables: () => ({
      getNodeAvailableVars: () => [],
    }),
  }
})

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
  const onChange = vi.fn()
  renderWorkflowFlowComponent(
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
        type: FormTypeEnum.textInput,
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
        type: FormTypeEnum.textInput,
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
