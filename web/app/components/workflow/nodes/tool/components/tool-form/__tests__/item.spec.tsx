import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import ToolFormItem from '../item'

const mockFormInputItem = vi.fn()
const mockSchemaModal = vi.fn()
let mockLanguage = 'en_US'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => mockLanguage,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent?: React.ReactNode }) => (
    <div data-testid="tooltip">{popupContent}</div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector/components', () => ({
  SchemaModal: (props: Record<string, unknown>) => {
    mockSchemaModal(props)
    return (
      <div data-testid="schema-modal">
        <span>{String(props.rootName)}</span>
        <button type="button" onClick={() => (props.onClose as () => void)?.()}>close-schema</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/form-input-item', () => ({
  default: (props: Record<string, unknown>) => {
    mockFormInputItem(props)
    return <div data-testid="form-input-item" />
  },
}))

const createSchema = (overrides: Partial<CredentialFormSchema> = {}): CredentialFormSchema => ({
  name: 'query',
  variable: 'query',
  show_on: [],
  type: FormTypeEnum.textInput,
  required: true,
  default: '',
  label: { en_US: 'Query', zh_Hans: 'Query' },
  tooltip: { en_US: 'Prompt description', zh_Hans: 'Prompt description' },
  ...overrides,
} as unknown as CredentialFormSchema)

describe('ToolFormItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLanguage = 'en_US'
  })

  it('should render required labels, descriptions, and forward props to FormInputItem', () => {
    render(
      <ToolFormItem
        readOnly={false}
        nodeId="tool-node"
        schema={createSchema()}
        value={{}}
        onChange={vi.fn()}
        inPanel
        showManageInputField
        onManageInputField={vi.fn()}
        extraParams={{ locale: 'en_US' }}
      />,
    )

    expect(screen.getByText('Query')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('Prompt description')).toBeInTheDocument()
    expect(screen.getByTestId('form-input-item')).toBeInTheDocument()
    expect(mockFormInputItem).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'tool-node',
      providerType: 'tool',
      showManageInputField: true,
    }))
  })

  it('should open the schema modal for object-like fields', async () => {
    const user = userEvent.setup()

    render(
      <ToolFormItem
        readOnly={false}
        nodeId="tool-node"
        schema={createSchema({
          name: 'payload',
          variable: 'payload',
          type: FormTypeEnum.object,
          required: false,
          tooltip: { en_US: 'Payload schema', zh_Hans: 'Payload schema' },
          input_schema: { type: Type.object, properties: { name: { type: Type.string } } } as unknown as NonNullable<CredentialFormSchema['input_schema']>,
        })}
        value={{}}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /JSON Schema/i }))

    expect(screen.getByTestId('schema-modal')).toHaveTextContent('payload')
    expect(mockSchemaModal).toHaveBeenCalledWith(expect.objectContaining({
      rootName: 'payload',
      schema: { type: 'object', properties: { name: { type: 'string' } } },
    }))
  })

  it('should render tooltip content for non-description fields and close the schema modal', async () => {
    const user = userEvent.setup()

    render(
      <ToolFormItem
        readOnly={false}
        nodeId="tool-node"
        schema={createSchema({
          label: { en_US: 'Payload', zh_Hans: '' },
          type: FormTypeEnum.array,
          tooltip: { en_US: 'Array tooltip', zh_Hans: '' },
          input_schema: { type: Type.array } as unknown as NonNullable<CredentialFormSchema['input_schema']>,
        })}
        value={{}}
        onChange={vi.fn()}
        providerType="trigger"
      />,
    )

    expect(screen.getByText('Payload')).toBeInTheDocument()
    expect(screen.getByTestId('tooltip')).toHaveTextContent('Array tooltip')
    expect(screen.queryByText('Prompt description')).not.toBeInTheDocument()
    expect(mockFormInputItem).toHaveBeenCalledWith(expect.objectContaining({
      providerType: 'trigger',
    }))

    await user.click(screen.getByRole('button', { name: /JSON Schema/i }))
    expect(screen.getByTestId('schema-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'close-schema' }))
    expect(screen.queryByTestId('schema-modal')).not.toBeInTheDocument()
  })

  it('should fall back to en_US labels and descriptions when the active language entry is missing', () => {
    mockLanguage = 'zh_Hans'

    render(
      <ToolFormItem
        readOnly={false}
        nodeId="tool-node"
        schema={createSchema({
          type: FormTypeEnum.secretInput,
          label: { en_US: 'Secret Label', zh_Hans: '' },
          tooltip: { en_US: 'Secret description', zh_Hans: '' },
        })}
        value={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Secret Label')).toBeInTheDocument()
    expect(screen.getByText('Secret description')).toBeInTheDocument()
  })
})
