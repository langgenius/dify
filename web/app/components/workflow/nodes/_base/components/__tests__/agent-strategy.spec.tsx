import type { ReactNode } from 'react'
import type {
  CredentialFormSchema,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaTextInput,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createDocLinkMock } from '../../../../__tests__/i18n'
import { AgentStrategy } from '../agent-strategy'

const createI18nLabel = (text: string) => ({ en_US: text, zh_Hans: text })
const mockDocLink = createDocLinkMock('/docs')

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: null }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (value: unknown) => {
    if (typeof value === 'string')
      return value
    if (value && typeof value === 'object' && 'en_US' in value)
      return value.en_US
    return 'label'
  },
}))

vi.mock('../../../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setControlPromptEditorRerenderKey: vi.fn(),
    }),
  }),
}))

vi.mock('../agent-strategy-selector', () => ({
  AgentStrategySelector: () => <div data-testid="agent-strategy-selector" />,
}))

vi.mock('../field', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../prompt/editor', () => ({
  default: ({ value }: { value: string }) => <div data-testid="agent-strategy-editor">{value}</div>,
}))

type MockFormRenderProps = {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  nodeId?: string
  nodeOutputVars?: unknown[]
  availableNodes?: unknown[]
}

type MockFormProps = {
  formSchemas: Array<{ variable: string }>
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  override?: [unknown, (schema: unknown, props: MockFormRenderProps) => ReactNode]
  nodeId?: string
  nodeOutputVars?: unknown[]
  availableNodes?: unknown[]
}

vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({ formSchemas, value, onChange, override, nodeId, nodeOutputVars, availableNodes }: MockFormProps) => {
    const renderOverride = override?.[1]

    return (
      <div data-testid="mock-form">
        {formSchemas.map(schema => (
          <div key={schema.variable}>
            {renderOverride?.(schema, {
              value,
              onChange,
              nodeId,
              nodeOutputVars,
              availableNodes,
            })}
          </div>
        ))}
      </div>
    )
  },
}))

describe('AgentStrategy', () => {
  const defaultProps = {
    strategy: {
      agent_strategy_provider_name: 'provider',
      agent_strategy_name: 'strategy',
      agent_strategy_label: 'Strategy',
      agent_output_schema: {},
      plugin_unique_identifier: 'plugin',
    },
    onStrategyChange: vi.fn(),
    formValue: {},
    onFormValueChange: vi.fn(),
    nodeOutputVars: [],
    availableNodes: [],
    nodeId: 'node-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createTextNumberSchema = (overrides: Partial<CredentialFormSchemaNumberInput> = {}): CredentialFormSchema => ({
    name: 'count',
    variable: 'count',
    label: createI18nLabel('Count'),
    type: FormTypeEnum.textNumber,
    required: false,
    show_on: [],
    default: '1',
    ...overrides,
  } as unknown as CredentialFormSchema)

  const createTextInputSchema = (overrides: Partial<CredentialFormSchemaTextInput> = {}): CredentialFormSchema => ({
    name: 'prompt',
    variable: 'prompt',
    label: createI18nLabel('Prompt'),
    type: FormTypeEnum.textInput,
    required: false,
    show_on: [],
    default: 'hello',
    ...overrides,
  })

  it('should render text-number schemas when min and max are zero', () => {
    render(
      <AgentStrategy
        {...defaultProps}
        formSchema={[createTextNumberSchema({
          min: 0,
          max: 0,
          default: '0',
        })]}
      />,
    )

    expect(screen.getByLabelText('Count')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should skip text-number schemas when min is missing', () => {
    render(
      <AgentStrategy
        {...defaultProps}
        formSchema={[createTextNumberSchema({
          max: 5,
        })]}
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('should skip text-number schemas when max is missing', () => {
    render(
      <AgentStrategy
        {...defaultProps}
        formSchema={[createTextNumberSchema({
          min: 0,
        })]}
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('should render text-input schemas through the editor override', () => {
    render(
      <AgentStrategy
        {...defaultProps}
        formSchema={[createTextInputSchema()]}
      />,
    )

    expect(screen.getByTestId('agent-strategy-editor')).toHaveTextContent('hello')
  })
})
