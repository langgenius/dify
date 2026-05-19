import type { EmailConfig, FormInputItem } from '../../../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { DeliveryMethodType } from '../../../types'
import DeliveryMethodItem from '../method-item'

type EmailConfigureModalProps = {
  open: boolean
  config?: EmailConfig
  onOpenChange: (open: boolean) => void
  onConfirm: (data: EmailConfig) => void
}

type TestEmailSenderProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jumpToEmailConfigModal: () => void
}

const mockUseAppContextSelector = vi.hoisted(() => vi.fn())
const mockEmailConfigureModal = vi.hoisted(() => vi.fn())
const mockTestEmailSender = vi.hoisted(() => vi.fn())

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { userProfile: { email: string } }) => string) =>
    mockUseAppContextSelector(selector),
}))

vi.mock('../email-configure-modal', () => ({
  default: (props: EmailConfigureModalProps) => {
    mockEmailConfigureModal(props)
    return props.open
      ? (
          <div data-testid="email-configure-modal">
            <button
              type="button"
              onClick={() => props.onConfirm({
                recipients: { whole_workspace: false, items: [] },
                subject: 'Configured subject',
                body: '{{#url#}}',
                debug_mode: false,
              })}
            >
              confirm-email-config
            </button>
            <button type="button" onClick={() => props.onOpenChange(false)}>close-email-config</button>
          </div>
        )
      : null
  },
}))

vi.mock('../test-email-sender', () => ({
  default: (props: TestEmailSenderProps) => {
    mockTestEmailSender(props)
    return props.open
      ? (
          <div data-testid="test-email-sender">
            <button type="button" onClick={props.jumpToEmailConfigModal}>jump-to-config</button>
            <button type="button" onClick={() => props.onOpenChange(false)}>close-test-sender</button>
          </div>
        )
      : null
  },
}))

const createEmailConfig = (overrides: Partial<EmailConfig> = {}): EmailConfig => ({
  recipients: {
    whole_workspace: false,
    items: [{ type: 'external', email: 'test@example.com' }],
  },
  subject: 'Hello',
  body: '{{#url#}}',
  debug_mode: false,
  ...overrides,
})

const formInputs: FormInputItem[] = [{
  type: InputVarType.textInput,
  output_variable_name: 'name',
  default: {
    selector: ['start', 'name'],
    type: 'constant',
    value: '',
  },
}]

const availableNodes = [{
  id: 'start',
  data: {
    title: 'Start',
    type: 'start',
  },
}] as unknown as Node[]

const nodesOutputVars = [{
  nodeId: 'start',
  title: 'Start',
  vars: [],
}] as NodeOutPutVar[]

const getMethodRow = (label: string) => {
  return screen.getByText(label).closest('div[class*="justify-between"]') as HTMLDivElement
}

describe('human-input/delivery-method/method-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAppContextSelector.mockImplementation(selector => selector({
      userProfile: {
        email: 'owner@example.com',
      },
    }))
  })

  it('should toggle and delete a webapp delivery method', () => {
    const handleChange = vi.fn()
    const handleDelete = vi.fn()

    render(
      <DeliveryMethodItem
        nodeId="node-1"
        method={{
          id: 'webapp-1',
          type: DeliveryMethodType.WebApp,
          enabled: true,
        }}
        onChange={handleChange}
        onDelete={handleDelete}
      />,
    )

    fireEvent.click(screen.getByRole('switch'))
    expect(handleChange).toHaveBeenCalledWith({
      id: 'webapp-1',
      type: DeliveryMethodType.WebApp,
      enabled: false,
    })

    const row = getMethodRow('webapp')
    const actionButtons = within(row).getAllByRole('button')
    const deleteButton = actionButtons[0]!

    fireEvent.mouseEnter(deleteButton)
    expect(row)!.toHaveClass('border-state-destructive-border')
    fireEvent.mouseLeave(deleteButton)
    expect(row).not.toHaveClass('border-state-destructive-border')

    fireEvent.click(deleteButton)
    expect(handleDelete).toHaveBeenCalledWith(DeliveryMethodType.WebApp)
  })

  it('should open configure and test flows for an email method with config', () => {
    const handleChange = vi.fn()
    const handleDelete = vi.fn()

    render(
      <DeliveryMethodItem
        nodeId="node-1"
        method={{
          id: 'email-1',
          type: DeliveryMethodType.Email,
          enabled: true,
          config: createEmailConfig({ debug_mode: true }),
        }}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        formContent="Hello {{#url#}}"
        formInputs={formInputs}
        onChange={handleChange}
        onDelete={handleDelete}
      />,
    )

    expect(screen.getByText('DEBUG'))!.toBeInTheDocument()

    const actionButtons = within(getMethodRow('email')).getAllByRole('button')

    fireEvent.click(actionButtons[0]!)
    expect(screen.getByTestId('test-email-sender'))!.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'close-test-sender' }))
    expect(screen.queryByTestId('test-email-sender')).not.toBeInTheDocument()

    fireEvent.click(actionButtons[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'jump-to-config' }))
    expect(screen.queryByTestId('test-email-sender')).not.toBeInTheDocument()
    expect(screen.getByTestId('email-configure-modal'))!.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'close-email-config' }))
    expect(screen.queryByTestId('email-configure-modal')).not.toBeInTheDocument()

    fireEvent.click(actionButtons[1]!)
    expect(screen.getByTestId('email-configure-modal'))!.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'confirm-email-config' }))
    expect(handleChange).toHaveBeenCalledWith(expect.objectContaining({
      id: 'email-1',
      type: DeliveryMethodType.Email,
      config: expect.objectContaining({
        subject: 'Configured subject',
      }),
    }))

    fireEvent.click(actionButtons[2]!)
    expect(handleDelete).toHaveBeenCalledWith(DeliveryMethodType.Email)
  })

  it('should open email config from the unconfigured button and from the test sender jump action', () => {
    render(
      <DeliveryMethodItem
        nodeId="node-1"
        method={{
          id: 'email-2',
          type: DeliveryMethodType.Email,
          enabled: false,
          config: undefined,
        }}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        formInputs={formInputs}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /workflow.nodes.humanInput.deliveryMethod.notConfigured/i }))
    expect(screen.getByTestId('email-configure-modal'))!.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'close-email-config' }))
    expect(screen.queryByTestId('email-configure-modal')).not.toBeInTheDocument()
  })

  it('should keep actions disabled in readonly mode', () => {
    const handleChange = vi.fn()

    render(
      <DeliveryMethodItem
        nodeId="node-1"
        method={{
          id: 'email-3',
          type: DeliveryMethodType.Email,
          enabled: true,
          config: createEmailConfig(),
        }}
        onChange={handleChange}
        onDelete={vi.fn()}
        readonly
      />,
    )

    fireEvent.click(screen.getByRole('switch'))
    expect(handleChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('email-configure-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('test-email-sender')).not.toBeInTheDocument()
  })
})
