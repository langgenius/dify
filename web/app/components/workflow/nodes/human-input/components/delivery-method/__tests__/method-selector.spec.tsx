import type { Node } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { DeliveryMethodType } from '../../../types'
import MethodSelector from '../method-selector'

const mockUuid = vi.hoisted(() => vi.fn())
const mockUseWorkflowNodes = vi.hoisted(() => vi.fn())
const mockUseProviderContextSelector = vi.hoisted(() => vi.fn())

vi.mock('uuid', () => ({
  v4: () => mockUuid(),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseWorkflowNodes(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: { humanInputEmailDeliveryEnabled: boolean }) => boolean) =>
    mockUseProviderContextSelector(selector),
}))

vi.mock('@/config', () => ({
  IS_CE_EDITION: false,
}))

describe('human-input/delivery-method/method-selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUuid.mockReturnValue('generated-id')
    mockUseWorkflowNodes.mockReturnValue([{
      id: 'start-node',
      data: { type: BlockEnum.Start },
    }] as Node[])
    mockUseProviderContextSelector.mockImplementation(selector => selector({
      humanInputEmailDeliveryEnabled: true,
    }))
  })

  it('should add webapp and email delivery methods when both entries are available', () => {
    const handleAdd = vi.fn()
    const handleShowUpgradeTip = vi.fn()

    render(
      <MethodSelector
        data={[]}
        onAdd={handleAdd}
        onShowUpgradeTip={handleShowUpgradeTip}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('workflow.nodes.humanInput.deliveryMethod.types.webapp.title'))
    fireEvent.click(screen.getByText('workflow.nodes.humanInput.deliveryMethod.types.email.title'))

    expect(handleAdd).toHaveBeenNthCalledWith(1, {
      id: 'generated-id',
      type: DeliveryMethodType.WebApp,
      enabled: true,
    })
    expect(handleAdd).toHaveBeenNthCalledWith(2, {
      id: 'generated-id',
      type: DeliveryMethodType.Email,
      enabled: false,
    })
    expect(handleShowUpgradeTip).not.toHaveBeenCalled()
    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.contactTip1')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('nodes.humanInput.deliveryMethod.contactTip2')
  })

  it('should disable webapp in trigger mode and show added states without creating duplicates', () => {
    const handleAdd = vi.fn()

    mockUseWorkflowNodes.mockReturnValue([{
      id: 'trigger-node',
      data: { type: BlockEnum.TriggerWebhook },
    }] as Node[])

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

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getAllByText('workflow.nodes.humanInput.deliveryMethod.added')).toHaveLength(2)

    fireEvent.click(screen.getByText('workflow.nodes.humanInput.deliveryMethod.types.webapp.title'))
    fireEvent.click(screen.getByText('workflow.nodes.humanInput.deliveryMethod.types.email.title'))

    expect(handleAdd).not.toHaveBeenCalled()
  })

  it('should show trigger-mode and permission guards for unavailable methods', () => {
    const handleAdd = vi.fn()
    const handleShowUpgradeTip = vi.fn()

    mockUseWorkflowNodes.mockReturnValue([{
      id: 'trigger-node',
      data: { type: BlockEnum.TriggerSchedule },
    }] as Node[])
    mockUseProviderContextSelector.mockImplementation(selector => selector({
      humanInputEmailDeliveryEnabled: false,
    }))

    render(
      <MethodSelector
        data={[]}
        onAdd={handleAdd}
        onShowUpgradeTip={handleShowUpgradeTip}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.notAvailableInTriggerMode')).toBeInTheDocument()

    fireEvent.click(screen.getByText('workflow.nodes.humanInput.deliveryMethod.types.webapp.title'))
    fireEvent.click(screen.getByText('workflow.nodes.humanInput.deliveryMethod.types.email.title'))

    expect(handleAdd).not.toHaveBeenCalled()
    expect(handleShowUpgradeTip).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('COMING SOON')).toHaveLength(3)
  })
})
