import type { Node } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { DeliveryMethodType } from '../../../types'
import MethodSelector from '../method-selector'

let emailDeliveryEnabled = true
let currentNodes: Node[] = []

const render = (ui: React.ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { human_input_email_delivery_enabled: emailDeliveryEnabled },
  })
  return renderWorkflowComponent(ui, { queryClient, initialStoreState: { nodes: currentNodes } })
}

describe('human-input/delivery-method/method-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentNodes = [createNode({ id: 'start-node', data: { type: BlockEnum.Start } })]
    emailDeliveryEnabled = true
  })

  it('should add webapp and email delivery methods when both entries are available', async () => {
    const user = userEvent.setup()
    const handleAdd = vi.fn()
    const handleShowUpgradeTip = vi.fn()

    render(<MethodSelector data={[]} onAdd={handleAdd} onShowUpgradeTip={handleShowUpgradeTip} />)

    await user.click(screen.getByRole('button'))
    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.types.webapp.title'),
    )
    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.types.email.title'),
    )

    expect(handleAdd).toHaveBeenNthCalledWith(1, {
      id: expect.any(String),
      type: DeliveryMethodType.WebApp,
      enabled: true,
    })
    expect(handleAdd).toHaveBeenNthCalledWith(2, {
      id: expect.any(String),
      type: DeliveryMethodType.Email,
      enabled: false,
    })
    expect(handleShowUpgradeTip).not.toHaveBeenCalled()
  })

  it('does not add duplicate delivery methods', async () => {
    const user = userEvent.setup()
    const handleAdd = vi.fn()

    render(
      <MethodSelector
        data={[
          { id: 'webapp-1', type: DeliveryMethodType.WebApp, enabled: true },
          { id: 'email-1', type: DeliveryMethodType.Email, enabled: false },
        ]}
        onAdd={handleAdd}
        onShowUpgradeTip={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(
      screen.getAllByText('workflowHumanInput.nodes.humanInput.deliveryMethod.added'),
    ).toHaveLength(2)

    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.types.webapp.title'),
    )
    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.types.email.title'),
    )

    expect(handleAdd).not.toHaveBeenCalled()
  })

  it('should show trigger-mode and permission guards for unavailable methods', async () => {
    const user = userEvent.setup()
    const handleAdd = vi.fn()
    const handleShowUpgradeTip = vi.fn()

    currentNodes = [createNode({ id: 'trigger-node', data: { type: BlockEnum.TriggerSchedule } })]
    emailDeliveryEnabled = false

    render(<MethodSelector data={[]} onAdd={handleAdd} onShowUpgradeTip={handleShowUpgradeTip} />)

    await user.click(screen.getByRole('button'))

    expect(
      screen.getByText(
        'workflowHumanInput.nodes.humanInput.deliveryMethod.notAvailableInTriggerMode',
      ),
    ).toBeInTheDocument()

    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.types.webapp.title'),
    )
    await user.click(
      screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.types.email.title'),
    )

    expect(handleAdd).not.toHaveBeenCalled()
    expect(handleShowUpgradeTip).toHaveBeenCalledTimes(1)
  })
})
