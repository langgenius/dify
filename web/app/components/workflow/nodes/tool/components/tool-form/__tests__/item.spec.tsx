import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ToolFormItem from '../item'

type MockSchemaModalProps = {
  isShow: boolean
  onClose: () => void
  rootName: string
  schema: SchemaRoot
}

type MockFormInputItemProps = Readonly<{
  schema: CredentialFormSchema
}>

const mockUseLanguage = vi.fn()
const mockSchemaModal = vi.fn<(props: MockSchemaModalProps) => void>()

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => mockUseLanguage(),
}))

vi.mock(
  '@/app/components/plugins/plugin-detail-panel/tool-selector/components/schema-modal',
  () => ({
    SchemaModal: (props: MockSchemaModalProps) => {
      mockSchemaModal(props)
      return props.isShow ? (
        <div data-testid="schema-modal">
          <span>{props.rootName}</span>
          <button type="button" onClick={props.onClose}>
            close-schema
          </button>
        </div>
      ) : null
    },
  }),
)

vi.mock('@/app/components/workflow/nodes/_base/components/form-input-item', () => ({
  default: ({ schema }: MockFormInputItemProps) => <div>{schema.variable}</div>,
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
  tooltip: {
    en_US: 'Enter API key',
    zh_Hans: 'Enter API key',
  },
  show_on: [],
  ...overrides,
})

describe('tool/tool-form/item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLanguage.mockReturnValue('en_US')
  })

  // URL fragments inside descriptions should be rendered as external links.
  it('should render URLs in descriptions as external links', () => {
    render(
      <ToolFormItem
        readOnly={false}
        nodeId="tool-node"
        schema={createSchema({
          tooltip: {
            en_US: 'Visit https://docs.dify.ai/tools for docs',
            zh_Hans: 'Visit https://docs.dify.ai/tools for docs',
          },
        })}
        value={{}}
        onChange={vi.fn()}
      />,
    )

    const link = screen.getByRole('link', { name: 'https://docs.dify.ai/tools' })
    expect(link)!.toHaveAttribute('href', 'https://docs.dify.ai/tools')
    expect(link)!.toHaveAttribute('target', '_blank')
    expect(link)!.toHaveAttribute('rel', 'noopener noreferrer')
    expect(link.parentElement)!.toHaveTextContent('Visit https://docs.dify.ai/tools for docs')
  })

  // Non-text fields keep their descriptions inside the tooltip and support JSON schema preview.
  it('should show tooltip for non-description fields and open the schema modal', () => {
    const objectSchema = createSchema({
      name: 'tool_config',
      variable: 'tool_config',
      label: {
        en_US: 'Tool Config',
        zh_Hans: 'Tool Config',
      },
      type: FormTypeEnum.object,
      tooltip: {
        en_US: 'Select from tools',
        zh_Hans: 'Select from tools',
      },
      input_schema: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
          },
        },
        additionalProperties: false,
      } as unknown as SchemaRoot,
    })

    render(
      <ToolFormItem
        readOnly={false}
        nodeId="tool-node"
        schema={objectSchema}
        value={{}}
        onChange={vi.fn()}
        providerType="trigger"
      />,
    )

    const infotipTrigger = screen.getByRole('button', { name: 'Select from tools' })
    fireEvent.click(infotipTrigger)
    expect(screen.getByText('Select from tools'))!.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'JSON Schema' }))
    const schemaModal = screen.getByTestId('schema-modal')
    expect(schemaModal)!.toBeInTheDocument()
    expect(within(schemaModal).getByText('tool_config'))!.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close-schema' }))
    expect(screen.queryByTestId('schema-modal')).not.toBeInTheDocument()
  })
})
