import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ToolForm from '../index'

const mockToolFormItem = vi.fn()

vi.mock('../item', () => ({
  default: (props: Record<string, unknown>) => {
    mockToolFormItem(props)
    return <div data-testid={`tool-form-item-${String(props.schema && (props.schema as { name?: string }).name)}`} />
  },
}))

const createSchema = (name: string): CredentialFormSchema => ({
  name,
  variable: name,
  show_on: [],
  type: FormTypeEnum.textInput,
  required: false,
  default: '',
  label: { en_US: name, zh_Hans: name },
} as unknown as CredentialFormSchema)

describe('ToolForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render one form item per schema entry and forward shared props', () => {
    render(
      <ToolForm
        readOnly={false}
        nodeId="tool-node"
        schema={[createSchema('query'), createSchema('limit')]}
        value={{}}
        onChange={vi.fn()}
        inPanel
        showManageInputField
        onManageInputField={vi.fn()}
        extraParams={{ locale: 'en_US' }}
      />,
    )

    expect(screen.getByTestId('tool-form-item-query')).toBeInTheDocument()
    expect(screen.getByTestId('tool-form-item-limit')).toBeInTheDocument()
    expect(mockToolFormItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
      readOnly: false,
      nodeId: 'tool-node',
      providerType: 'tool',
      showManageInputField: true,
    }))
    expect(mockToolFormItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
      schema: expect.objectContaining({ name: 'limit' }),
    }))
  })
})
