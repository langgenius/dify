import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeliveryMethodType } from '../../../types'
import DeliveryMethodForm from '../index'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseNodesSyncDraft = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => mockUseNodesSyncDraft(),
}))

vi.mock('../method-selector', () => ({
  __esModule: true,
  default: (props: {
    onAdd: (method: { id: string, type: DeliveryMethodType, enabled: boolean }) => void
    onShowUpgradeTip: () => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => props.onAdd({ id: 'email-1', type: DeliveryMethodType.Email, enabled: false })}
      >
        add-method
      </button>
      <button type="button" onClick={props.onShowUpgradeTip}>
        show-upgrade
      </button>
    </div>
  ),
}))

vi.mock('../method-item', () => ({
  __esModule: true,
  default: (props: {
    method: { type: DeliveryMethodType, enabled: boolean }
    onChange: (method: { type: DeliveryMethodType, enabled: boolean }) => void
    onDelete: (type: DeliveryMethodType) => void
  }) => (
    <div data-testid={`method-${props.method.type}`}>
      <button
        type="button"
        onClick={() => props.onChange({ ...props.method, enabled: !props.method.enabled })}
      >
        change-method
      </button>
      <button
        type="button"
        onClick={() => props.onDelete(props.method.type)}
      >
        delete-method
      </button>
    </div>
  ),
}))

describe('DeliveryMethodForm', () => {
  const onChange = vi.fn()
  const mockHandleSyncWorkflowDraft = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseNodesSyncDraft.mockReturnValue({
      handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
    })
  })

  it('should render the empty state and add methods through the selector', () => {
    render(
      <DeliveryMethodForm
        nodeId="node-1"
        value={[]}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('nodes.humanInput.deliveryMethod.emptyTip')).toBeInTheDocument()
    fireEvent.click(screen.getByText('add-method'))

    expect(onChange).toHaveBeenCalledWith([
      {
        id: 'email-1',
        type: DeliveryMethodType.Email,
        enabled: false,
      },
    ])
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
  })

  it('should change and delete methods, syncing the draft after updates', () => {
    render(
      <DeliveryMethodForm
        nodeId="node-1"
        value={[{
          id: 'email-1',
          type: DeliveryMethodType.Email,
          enabled: false,
        }]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('change-method'))
    fireEvent.click(screen.getByText('delete-method'))

    expect(onChange).toHaveBeenNthCalledWith(1, [{
      id: 'email-1',
      type: DeliveryMethodType.Email,
      enabled: true,
    }])
    expect(onChange).toHaveBeenNthCalledWith(2, [])
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true, true)
  })

  it('should open and close the upgrade modal', async () => {
    render(
      <DeliveryMethodForm
        nodeId="node-1"
        value={[]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('show-upgrade'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'nodes.humanInput.deliveryMethod.upgradeTipHide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
