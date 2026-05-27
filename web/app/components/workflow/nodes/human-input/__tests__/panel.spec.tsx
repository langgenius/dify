import type { ReactNode } from 'react'
import type useConfig from '../hooks/use-config'
import type { HumanInputNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'
import { DeliveryMethodType, UserActionButtonType } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseAvailableVarList = vi.hoisted(() => vi.fn())
const mockDeliveryMethod = vi.hoisted(() => vi.fn())
const mockFormContent = vi.hoisted(() => vi.fn())
const mockFormContentPreview = vi.hoisted(() => vi.fn())
const mockTimeoutInput = vi.hoisted(() => vi.fn())
const mockUserActionItem = vi.hoisted(() => vi.fn())

vi.mock('copy-to-clipboard', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/app/components/base/action-button', () => ({
  __esModule: true,
  default: (props: {
    children: ReactNode
    onClick: () => void
  }) => (
    <button type="button" aria-label="action-button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodePanelWidth: number }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('../hooks/use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../components/delivery-method', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    onChange: (methods: HumanInputNodeType['delivery_methods']) => void
  }) => {
    mockDeliveryMethod(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange([{
          id: 'dm-email',
          type: DeliveryMethodType.Email,
          enabled: true,
        }])}
      >
        {props.readonly ? 'delivery-method:readonly' : 'delivery-method:editable'}
      </button>
    )
  },
}))

vi.mock('../components/form-content', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    isExpand: boolean
    onChange: (value: string) => void
    onFormInputsChange: (value: HumanInputNodeType['inputs']) => void
    onFormInputItemRename: (oldName: string, newName: string) => void
    onFormInputItemRemove: (name: string) => void
  }) => {
    mockFormContent(props)
    return (
      <div>
        <div>{props.readonly ? 'form-content:readonly' : `form-content:${props.isExpand ? 'expanded' : 'collapsed'}`}</div>
        <button type="button" onClick={() => props.onChange('Updated content')}>
          change-form-content
        </button>
        <button
          type="button"
          onClick={() => props.onFormInputsChange([{
            type: InputVarType.textInput,
            output_variable_name: 'email',
            default: {
              selector: [],
              type: 'constant',
              value: '',
            },
          }])}
        >
          change-form-inputs
        </button>
        <button type="button" onClick={() => props.onFormInputItemRename('name', 'email')}>
          rename-form-input
        </button>
        <button type="button" onClick={() => props.onFormInputItemRemove('name')}>
          remove-form-input
        </button>
      </div>
    )
  },
}))

vi.mock('../components/form-content-preview', () => ({
  __esModule: true,
  default: (props: {
    onClose: () => void
  }) => {
    mockFormContentPreview(props)
    return (
      <div>
        <div>form-preview</div>
        <button type="button" onClick={props.onClose}>
          close-preview
        </button>
      </div>
    )
  },
}))

vi.mock('../components/timeout', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    onChange: (value: { timeout: number, unit: 'hour' | 'day' }) => void
  }) => {
    mockTimeoutInput(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange({ timeout: 8, unit: 'hour' })}
      >
        {props.readonly ? 'timeout:readonly' : 'timeout:editable'}
      </button>
    )
  },
}))

vi.mock('../components/user-action', () => ({
  __esModule: true,
  default: (props: {
    readonly: boolean
    data: HumanInputNodeType['user_actions'][number]
    onChange: (value: HumanInputNodeType['user_actions'][number]) => void
    onDelete: (id: string) => void
  }) => {
    mockUserActionItem(props)
    return (
      <div>
        <div>{`${props.data.id}:${props.readonly ? 'readonly' : 'editable'}`}</div>
        <button
          type="button"
          onClick={() => props.onChange({
            ...props.data,
            title: `${props.data.title} updated`,
          })}
        >
          {`change-action-${props.data.id}`}
        </button>
        <button type="button" onClick={() => props.onDelete(props.data.id)}>
          {`delete-action-${props.data.id}`}
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: (props: {
    children: ReactNode
    collapsed?: boolean
    onCollapse?: (collapsed: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => props.onCollapse?.(!props.collapsed)}>
        toggle-output-vars
      </button>
      {props.children}
    </div>
  ),
  VarItem: ({ name, type, description }: { name: string, type: string, description: string }) => (
    <div>{`${name}:${type}:${description}`}</div>
  ),
}))

vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <span>add-icon</span>,
  RiClipboardLine: () => <span>clipboard-icon</span>,
  RiCollapseDiagonalLine: () => <span>collapse-icon</span>,
  RiExpandDiagonalLine: () => <span>expand-icon</span>,
  RiEyeLine: () => <span>preview-icon</span>,
}))

const mockCopy = vi.mocked(copy)
const mockToastSuccess = vi.mocked(toast.success)

const createData = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [{
    id: 'dm-webapp',
    type: DeliveryMethodType.WebApp,
    enabled: true,
  }],
  form_content: 'Please review this request',
  inputs: [{
    type: InputVarType.textInput,
    output_variable_name: 'review_result',
    default: {
      selector: [],
      type: 'constant',
      value: '',
    },
  }],
  user_actions: [{
    id: 'approve',
    title: 'Approve',
    button_style: UserActionButtonType.Primary,
  }],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
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
  structuredOutputCollapsed: true,
  setStructuredOutputCollapsed: vi.fn(),
  ...overrides,
})

const renderPanel = (data: HumanInputNodeType = createData()) => {
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

  return render(<Panel {...props} />)
}

describe('human-input/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseStore.mockImplementation(selector => selector({ nodePanelWidth: 480 }))
    mockUseAvailableVarList.mockImplementation((_id, options?: { filterVar?: (payload: { type: VarType }) => boolean }) => ({
      availableVars: [{
        variable: ['start', 'email'],
        type: VarType.string,
      }, {
        variable: ['start', 'files'],
        type: VarType.file,
      }].filter(variable => options?.filterVar ? options.filterVar({ type: variable.type } as never) : true),
      availableNodesWithParent: [{
        id: 'start-node',
        data: {
          title: 'Start',
          type: BlockEnum.Start,
        },
      }],
    }))
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('renders editable controls, forwards updates, and toggles preview and output sections', async () => {
    const user = userEvent.setup()
    const config = createConfigResult()
    mockUseConfig.mockReturnValue(config)

    renderPanel()

    expect(screen.getByRole('button', { name: 'delivery-method:editable' })).toBeInTheDocument()
    expect(screen.getByText('form-content:collapsed')).toBeInTheDocument()
    expect(screen.getByText('approve:editable')).toBeInTheDocument()
    expect(screen.getByText('review_result:string:Form input value')).toBeInTheDocument()
    expect(screen.getByText('__action_id:string:Action ID user triggered')).toBeInTheDocument()
    expect(screen.getByText('__action_value:string:Selected action value')).toBeInTheDocument()
    expect(screen.getByText('__rendered_content:string:Rendered content')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'delivery-method:editable' }))
    await user.click(screen.getByRole('button', { name: /workflow\.nodes\.humanInput\.formContent\.preview/ }))
    await user.click(screen.getByRole('button', { name: 'change-form-content' }))
    await user.click(screen.getByRole('button', { name: 'change-form-inputs' }))
    await user.click(screen.getByRole('button', { name: 'rename-form-input' }))
    await user.click(screen.getByRole('button', { name: 'remove-form-input' }))
    await user.click(screen.getByRole('button', { name: 'action-button' }))
    await user.click(screen.getByRole('button', { name: 'change-action-approve' }))
    await user.click(screen.getByRole('button', { name: 'delete-action-approve' }))
    await user.click(screen.getByRole('button', { name: 'timeout:editable' }))
    await user.click(screen.getByRole('button', { name: 'toggle-output-vars' }))
    await user.click(screen.getByRole('button', { name: 'close-preview' }))

    await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
    await user.click(screen.getByRole('button', { name: 'share.chat.expand' }))

    expect(config.handleDeliveryMethodChange).toHaveBeenCalledWith([{
      id: 'dm-email',
      type: DeliveryMethodType.Email,
      enabled: true,
    }])
    expect(config.handleFormContentChange).toHaveBeenCalledWith('Updated content')
    expect(config.handleFormInputsChange).toHaveBeenCalled()
    expect(config.handleFormInputItemRename).toHaveBeenCalledWith('name', 'email')
    expect(config.handleFormInputItemRemove).toHaveBeenCalledWith('name')
    expect(config.handleUserActionAdd).toHaveBeenCalledWith({
      id: 'action_2',
      title: 'Button Text 2',
      button_style: UserActionButtonType.Default,
    })
    expect(config.handleUserActionChange).toHaveBeenCalledWith(0, {
      id: 'approve',
      title: 'Approve updated',
      button_style: UserActionButtonType.Primary,
    })
    expect(config.handleUserActionDelete).toHaveBeenCalledWith('approve')
    expect(config.handleTimeoutChange).toHaveBeenCalledWith({ timeout: 8, unit: 'hour' })
    expect(config.setStructuredOutputCollapsed).toHaveBeenCalledWith(false)
    expect(mockCopy).toHaveBeenCalledWith('Please review this request')
    expect(mockToastSuccess).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
    expect(mockFormContentPreview).toHaveBeenCalled()
  })

  it('renders readonly and empty states without preview or add controls', () => {
    mockUseConfig.mockReturnValue(createConfigResult({
      readOnly: true,
      inputs: createData({
        user_actions: [],
      }),
      structuredOutputCollapsed: false,
    }))

    renderPanel()

    expect(screen.getByRole('button', { name: 'delivery-method:readonly' })).toBeInTheDocument()
    expect(screen.getByText('form-content:readonly')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInput.userActions.emptyTip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /workflow\.nodes\.humanInput\.formContent\.preview/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'action-button' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'timeout:readonly' })).toBeInTheDocument()
    expect(screen.queryByText('form-preview')).not.toBeInTheDocument()
  })
})
