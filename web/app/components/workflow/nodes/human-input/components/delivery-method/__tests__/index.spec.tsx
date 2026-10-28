import type { DeliveryMethod } from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { DeliveryMethodType } from '../../../types'
import DeliveryMethodForm from '../index'

const prefix = 'workflowHumanInput.nodes.humanInput.deliveryMethod.'
function renderMethods(initial: DeliveryMethod[], emailDeliveryEnabled = true) {
  function Form() {
    const [methods, setMethods] = useState(initial)
    return <DeliveryMethodForm nodeId="node-1" value={methods} onChange={setMethods} />
  }
  const { queryClient } = createConsoleQueryWrapper({
    features: { human_input_email_delivery_enabled: emailDeliveryEnabled },
  })
  return renderWorkflowFlowComponent(
    <NuqsTestingAdapter>
      <Form />
    </NuqsTestingAdapter>,
    {
      queryClient,
    },
  )
}

it('adds, changes, and removes the selected method while preserving other methods', async () => {
  const user = userEvent.setup()
  renderMethods([{ id: 'email-1', type: DeliveryMethodType.Email, enabled: false }])
  await user.click(screen.getAllByRole('button', { name: `${prefix}title` })[1]!)
  await user.click(screen.getByText(`${prefix}types.webapp.title`))
  await user.keyboard('{Escape}')
  const toggle = screen.getByRole('switch')
  expect(toggle).toBeChecked()
  expect(screen.getByText('email')).toBeInTheDocument()
  await user.click(toggle)
  expect(toggle).not.toBeChecked()
  // The existing email entry precedes the newly added WebApp entry.
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
  expect(screen.queryByText('webapp')).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.getByText('email')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: `${prefix}notConfigured` })).toBeInTheDocument()
})

it('opens the upgrade modal for unavailable email delivery and closes it', async () => {
  const user = userEvent.setup()
  renderMethods([], false)
  await user.click(screen.getAllByRole('button', { name: `${prefix}title` })[1]!)
  await user.click(screen.getByText(`${prefix}types.email.title`))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: `${prefix}upgradeTipHide` }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText('email')).not.toBeInTheDocument()
})
