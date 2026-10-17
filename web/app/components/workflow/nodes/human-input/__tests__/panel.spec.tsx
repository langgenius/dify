import type useConfig from '../hooks/use-config'
import type { HumanInputNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { renderWorkflowFlowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import Panel from '../panel'
import { DeliveryMethodType, UserActionButtonType } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../hooks/use-config', () => ({ default: (...args: unknown[]) => mockUseConfig(...args) }))

// Delivery configuration has its own interaction suite; these cases exercise panel-owned controls.
vi.mock('../components/delivery-method', () => ({ default: () => null }))
// Keep the rich editor runtime outside this panel composition test.
vi.mock('../components/form-content', () => ({
  default: ({
    value,
    onChange,
    readonly,
  }: {
    value: string
    onChange: (value: string) => void
    readonly: boolean
  }) => (
    <textarea
      aria-label="Form content"
      value={value}
      readOnly={readonly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const createData = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [
    {
      id: 'dm-webapp',
      type: DeliveryMethodType.WebApp,
      enabled: true,
    },
  ],
  form_content: 'Please review this request',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'review_result',
      default: {
        selector: [],
        type: 'constant',
        value: '',
      },
    },
  ],
  user_actions: [
    {
      id: 'approve',
      title: 'Approve',
      button_style: UserActionButtonType.Primary,
    },
  ],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})

const createConfigResult = (
  overrides: Partial<ReturnType<typeof useConfig>> = {},
): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  handleDeliveryMethodChange: vi.fn(),
  handleUserActionAdd: vi.fn(),
  handleUserActionChange: vi.fn(),
  handleUserActionDelete: vi.fn(),
  handleTimeoutChange: vi.fn(),
  handleFormContentChange: vi.fn(),
  handleFormInputsChange: vi.fn(),
  handleFormInputItemRename: vi.fn(),
  handleFormInputItemRemove: vi.fn(),
  editorKey: 1,
  structuredOutputCollapsed: false,
  setStructuredOutputCollapsed: vi.fn(),
  ...overrides,
})

const renderPanel = (data: HumanInputNodeType = createData()) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])

  const props: NodePanelProps<HumanInputNodeType> = {
    id: 'human-input-node',
    data,
    panelProps: {
      getInputVars: vi.fn(() => []),
      toVarInputs: vi.fn(() => []),
      runInputData: {},
      runInputDataRef: { current: {} },
      setRunInputData: vi.fn(),
      runResult: null,
    },
  }

  return render(<Panel {...props} />, { queryClient })
}

describe('human-input/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('adds an action using the next index and forwards edits and deletion from real controls', async () => {
    const user = userEvent.setup()
    const config = createConfigResult()
    mockUseConfig.mockReturnValue(config)
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(config.handleUserActionAdd).toHaveBeenCalledWith({
      id: 'action_2',
      title: 'Button Text 2',
      button_style: UserActionButtonType.Default,
    })
    const title = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'workflowHumanInput.nodes.humanInput.userActions.buttonTextPlaceholder',
    })
    await user.click(title)
    title.select()
    await user.paste('Accept request')
    expect(config.handleUserActionChange).toHaveBeenCalledWith(0, {
      id: 'approve',
      title: 'Accept request',
      button_style: UserActionButtonType.Primary,
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    expect(config.handleUserActionDelete).toHaveBeenCalledWith('approve')
    await user.click(
      screen.getByRole('radio', { name: 'workflowHumanInput.nodes.humanInput.timeout.hours' }),
    )
    expect(config.handleTimeoutChange).toHaveBeenCalledWith({ timeout: 3, unit: 'hour' })
  })

  it('copies form content, expands the editor and opens and closes the real preview', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    expect(copy).toHaveBeenCalledWith('Please review this request')
    expect(toast.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')

    await user.click(screen.getByRole('button', { name: 'share.chat.expand' }))
    await user.click(screen.getByRole('button', { name: 'share.chat.collapse' }))
    expect(screen.getByRole('button', { name: 'share.chat.expand' })).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.formContent.preview',
      }),
    )
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.editor.previewTip'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(
      screen.queryByText('workflowHumanInput.nodes.humanInput.editor.previewTip'),
    ).not.toBeInTheDocument()
  })

  it('prevents edits in readonly mode', async () => {
    const user = userEvent.setup()
    const config = createConfigResult({ readOnly: true })
    mockUseConfig.mockReturnValue(config)
    renderPanel()

    expect(screen.getByRole('textbox', { name: 'Form content' })).toHaveAttribute('readonly')
    expect(screen.getByDisplayValue('Approve')).toBeDisabled()
    expect(screen.getByDisplayValue('approve')).toBeDisabled()
    expect(
      screen.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' }),
    ).toBeDisabled()
    const hours = screen.getByRole('radio', {
      name: 'workflowHumanInput.nodes.humanInput.timeout.hours',
    })
    expect(hours).toBeDisabled()
    await user.click(hours)
    expect(config.handleTimeoutChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'common.operation.add' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.formContent.preview',
      }),
    ).not.toBeInTheDocument()
  })

  it('offers the first action when the action list is empty', async () => {
    const config = createConfigResult({ inputs: createData({ user_actions: [] }) })
    mockUseConfig.mockReturnValue(config)
    renderPanel()
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.userActions.emptyTip'),
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(config.handleUserActionAdd).toHaveBeenCalledWith({
      id: 'action_1',
      title: 'Button Text 1',
      button_style: UserActionButtonType.Default,
    })
  })

  it('exposes file-aware input outputs alongside action metadata', () => {
    mockUseConfig.mockReturnValue(
      createConfigResult({
        inputs: createData({
          inputs: [
            {
              type: InputVarType.singleFile,
              output_variable_name: 'attachment',
              allowed_file_extensions: [],
              allowed_file_types: [],
              allowed_file_upload_methods: [],
            },
            {
              type: InputVarType.multiFiles,
              output_variable_name: 'attachments',
              allowed_file_extensions: [],
              allowed_file_types: [],
              allowed_file_upload_methods: [],
              number_limits: 3,
            },
          ],
        }),
      }),
    )
    renderPanel()
    expect(
      within(screen.getByText('attachment').parentElement!).getByText('file'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByText('attachments').parentElement!).getByText('array[file]'),
    ).toBeInTheDocument()
    expect(screen.getByText('__action_id')).toBeInTheDocument()
    expect(screen.getByText('__action_value')).toBeInTheDocument()
    expect(screen.getByText('__rendered_content')).toBeInTheDocument()
  })
})
