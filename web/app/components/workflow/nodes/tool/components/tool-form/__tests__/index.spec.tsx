import type { ToolVarInputs } from '../../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType } from '../../../types'
import ToolForm from '../index'

type MockToolFormItemProps = {
  readOnly: boolean
  nodeId: string
  schema: CredentialFormSchema
  value: ToolVarInputs
  onChange: (value: ToolVarInputs) => void
  inPanel?: boolean
  showManageInputField?: boolean
  onManageInputField?: () => void
  extraParams?: Record<string, unknown>
  providerType?: 'tool' | 'trigger'
}

const mockToolFormItem = vi.fn<(props: MockToolFormItemProps) => void>()

vi.mock('../item', () => ({
  default: (props: MockToolFormItemProps) => {
    mockToolFormItem(props)
    return <div data-testid={`tool-form-item-${props.schema.variable}`}>{props.schema.label.en_US}</div>
  },
}))

const createSchema = (overrides: Partial<CredentialFormSchema> = {}): CredentialFormSchema => ({
  name: 'api_key',
  variable: 'api_key',
  label: {
    en_US: 'API Key',
    zh_Hans: 'API Key',
  },
  type: FormTypeEnum.textInput,
  required: true,
  show_on: [],
  ...overrides,
})

describe('tool/tool-form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render every schema item and forward tool-specific props', () => {
    const handleChange = vi.fn()
    const handleManageInputField = vi.fn()
    const value: ToolVarInputs = {
      api_key: {
        type: VarType.constant,
        value: 'secret',
      },
    }

    render(
      <ToolForm
        readOnly
        nodeId="tool-node"
        schema={[
          createSchema(),
          createSchema({
            name: 'region',
            variable: 'region',
            label: {
              en_US: 'Region',
              zh_Hans: 'Region',
            },
          }),
        ]}
        value={value}
        onChange={handleChange}
        inPanel
        showManageInputField
        onManageInputField={handleManageInputField}
        extraParams={{ mode: 'panel' }}
      />,
    )

    expect(screen.getByTestId('tool-form-item-api_key'))!.toBeInTheDocument()
    expect(screen.getByTestId('tool-form-item-region'))!.toBeInTheDocument()
    expect(mockToolFormItem).toHaveBeenCalledTimes(2)
    expect(mockToolFormItem.mock.calls[0]![0]).toMatchObject({
      readOnly: true,
      nodeId: 'tool-node',
      schema: expect.objectContaining({ variable: 'api_key' }),
      value,
      onChange: handleChange,
      inPanel: true,
      showManageInputField: true,
      onManageInputField: handleManageInputField,
      extraParams: { mode: 'panel' },
      providerType: 'tool',
    })
  })

  it('should render an empty container when schema is empty', () => {
    const { container } = render(
      <ToolForm
        readOnly={false}
        nodeId="tool-node"
        schema={[]}
        value={{}}
        onChange={vi.fn()}
      />,
    )

    expect(container.firstChild)!.toHaveClass('space-y-1')
    expect(screen.queryByTestId(/tool-form-item-/)).not.toBeInTheDocument()
    expect(mockToolFormItem).not.toHaveBeenCalled()
  })
})
