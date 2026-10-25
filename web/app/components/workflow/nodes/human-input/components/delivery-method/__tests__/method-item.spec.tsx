import type { ReactElement } from 'react'
import type { EmailConfig, FormInputItem } from '../../../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { render as renderWithConsoleState } from '@/test/console/render'
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

const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    email: 'owner@example.com',
  },
}))

const render = (ui: ReactElement) =>
  renderWithConsoleState(ui, {
    wrapper: createAccountProfileQueryWrapper(mockConsoleState.userProfile),
  })

vi.mock('../email-configure-modal', () => ({
  default: (props: EmailConfigureModalProps) => {
    return props.open ? (
      <div data-testid="email-configure-modal">
        <button
          type="button"
          onClick={() =>
            props.onConfirm({
              recipients: { whole_workspace: false, items: [] },
              subject: 'Configured subject',
              body: '{{#url#}}',
              debug_mode: false,
            })
          }
        >
          confirm-email-config
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close-email-config
        </button>
      </div>
    ) : null
  },
}))

vi.mock('../test-email-sender', () => ({
  default: (props: TestEmailSenderProps) => {
    return props.open ? (
      <div data-testid="test-email-sender">
        <button type="button" onClick={props.jumpToEmailConfigModal}>
          jump-to-config
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          close-test-sender
        </button>
      </div>
    ) : null
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

const formInputs: FormInputItem[] = [
  {
    type: InputVarType.paragraph,
    output_variable_name: 'name',
    default: {
      selector: ['start', 'name'],
      type: 'constant',
      value: '',
    },
  },
]

const availableNodes = [
  {
    id: 'start',
    data: {
      title: 'Start',
      type: 'start',
    },
  },
] as unknown as Node[]

const nodesOutputVars = [
  {
    nodeId: 'start',
    title: 'Start',
    vars: [],
  },
] as NodeOutPutVar[]

describe('human-input/delivery-method/method-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toggle and delete a webapp delivery method', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('switch'))
    expect(handleChange).toHaveBeenCalledWith({
      id: 'webapp-1',
      type: DeliveryMethodType.WebApp,
      enabled: false,
    })

    const deleteButton = screen.getByRole('button', { name: 'common.operation.remove' })

    await user.click(deleteButton)
    expect(handleDelete).toHaveBeenCalledWith(DeliveryMethodType.WebApp)
  })

  it('should open configure and test flows for an email method with config', async () => {
    const user = userEvent.setup()
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

    const testButton = screen.getByRole('button', { name: /emailSender.testSendTipInDebugMode/ })

    await user.click(testButton)
    expect(screen.getByTestId('test-email-sender'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'close-test-sender' }))
    expect(screen.queryByTestId('test-email-sender')).not.toBeInTheDocument()

    await user.click(testButton)
    await user.click(screen.getByRole('button', { name: 'jump-to-config' }))
    expect(screen.queryByTestId('test-email-sender')).not.toBeInTheDocument()
    expect(screen.getByTestId('email-configure-modal'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'close-email-config' }))
    expect(screen.queryByTestId('email-configure-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.common.configure' }))
    expect(screen.getByTestId('email-configure-modal'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'confirm-email-config' }))
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'email-1',
        type: DeliveryMethodType.Email,
        config: expect.objectContaining({
          subject: 'Configured subject',
        }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(handleDelete).toHaveBeenCalledWith(DeliveryMethodType.Email)
  })

  it('should open email config from the unconfigured button and from the test sender jump action', async () => {
    const user = userEvent.setup()
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

    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput.nodes.humanInput.deliveryMethod.notConfigured/i,
      }),
    )
    expect(screen.getByTestId('email-configure-modal'))!.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'close-email-config' }))
    expect(screen.queryByTestId('email-configure-modal')).not.toBeInTheDocument()
  })

  it('should keep actions disabled in readonly mode', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('switch'))
    expect(handleChange).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.common.configure' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('email-configure-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('test-email-sender')).not.toBeInTheDocument()
  })
})
