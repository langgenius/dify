import type { DeliveryMethod } from '../../../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { DeliveryMethodType } from '../../../types'
import DeliveryMethodForm from '../index'

const mockHandleSyncWorkflowDraft = vi.fn()

vi.mock('../method-selector', () => ({
  __esModule: true,
  default: (props: { onAdd: (method: DeliveryMethod) => void; onShowUpgradeTip: () => void }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          props.onAdd({ id: 'webapp-1', type: DeliveryMethodType.WebApp, enabled: true })
        }
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
    method: DeliveryMethod
    onChange: (method: DeliveryMethod) => void
    onDelete: (type: DeliveryMethodType) => void
  }) => (
    <section aria-label={props.method.type}>
      <button
        type="button"
        onClick={() => props.onChange({ ...props.method, enabled: !props.method.enabled })}
      >
        change-method
      </button>
      <button type="button" onClick={() => props.onDelete(props.method.type)}>
        delete-method
      </button>
    </section>
  ),
}))

describe('DeliveryMethodForm', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds, changes, and removes the selected method while preserving other methods', async () => {
    const user = userEvent.setup()
    const email: DeliveryMethod = { id: 'email-1', type: DeliveryMethodType.Email, enabled: false }
    function Form() {
      const [methods, setMethods] = useState<DeliveryMethod[]>([email])
      return (
        <DeliveryMethodForm
          nodeId="node-1"
          value={methods}
          onChange={(next) => {
            setMethods(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Form />)
    await user.click(screen.getByRole('button', { name: 'add-method' }))
    const webapp: DeliveryMethod = {
      id: 'webapp-1',
      type: DeliveryMethodType.WebApp,
      enabled: true,
    }
    expect(onChange).toHaveBeenLastCalledWith([email, webapp])
    expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
    const method = screen.getByRole('region', { name: DeliveryMethodType.WebApp })
    await user.click(within(method).getByRole('button', { name: 'change-method' }))
    expect(onChange).toHaveBeenLastCalledWith([email, { ...webapp, enabled: false }])
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith(true, undefined)
    await user.click(within(method).getByRole('button', { name: 'delete-method' }))
    expect(onChange).toHaveBeenLastCalledWith([email])
    expect(
      screen.queryByRole('region', { name: DeliveryMethodType.WebApp }),
    ).not.toBeInTheDocument()
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(1)
  })

  it('should open and close the upgrade modal', async () => {
    const user = userEvent.setup()
    render(<DeliveryMethodForm nodeId="node-1" value={[]} onChange={onChange} />)

    await user.click(screen.getByText('show-upgrade'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.upgradeTipHide',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

function render(ui: React.ReactElement) {
  const { queryClient } = createConsoleQueryWrapper()
  return renderWorkflowFlowComponent(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>, {
    queryClient,
    hooksStoreProps: { doSyncWorkflowDraft: mockHandleSyncWorkflowDraft },
  })
}
