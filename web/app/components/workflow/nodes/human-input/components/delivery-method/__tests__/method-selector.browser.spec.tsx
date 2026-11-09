import type { DeliveryMethod } from '../../../types'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { DeliveryMethodType } from '../../../types'
import MethodSelector from '../method-selector'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'workflowHumanInput.nodes.humanInput.deliveryMethod.title': 'Add delivery method',
    'workflowHumanInput.nodes.humanInput.deliveryMethod.types.webapp.title': 'Web app',
    'workflowHumanInput.nodes.humanInput.deliveryMethod.types.webapp.description':
      'Deliver in the web app',
    'workflowHumanInput.nodes.humanInput.deliveryMethod.types.email.title': 'Email',
    'workflowHumanInput.nodes.humanInput.deliveryMethod.types.email.description': 'Send by email',
    'workflowHumanInput.nodes.humanInput.deliveryMethod.added': 'Added',
    'workflowHumanInput.nodes.humanInput.deliveryMethod.notAvailableInTriggerMode':
      'Unavailable in trigger mode',
  })
})

const webapp = () => page.getByText('Web app')
const email = () => page.getByText('Email')

async function renderSelector(initial: DeliveryMethod[] = [], trigger = false) {
  function Caller() {
    const [data, setData] = useState(initial)
    const [upgrade, setUpgrade] = useState(false)
    return (
      <>
        <MethodSelector
          data={data}
          onAdd={(method) => setData((previous) => [...previous, method])}
          onShowUpgradeTip={() => setUpgrade(true)}
        />
        <output aria-label="Delivery methods">{JSON.stringify(data)}</output>
        {upgrade && <p>Upgrade requested</p>}
      </>
    )
  }
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { human_input_email_delivery_enabled: !trigger },
  })
  return renderWorkflowBrowserComponent(<Caller />, {
    queryClient,
    initialStoreState: {
      nodes: [
        createNode({
          id: 'entry',
          data: { type: trigger ? BlockEnum.TriggerSchedule : BlockEnum.Start },
        }),
      ],
    },
  })
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})

it('adds both methods with their defaults and reflects additions before another click', async () => {
  await renderSelector()
  await page.getByRole('button', { name: 'Add delivery method' }).click()
  await webapp().click()
  await expect.element(page.getByText('Added')).toBeVisible()
  await email().click()
  await expect.element(page.getByText('Added')).toHaveLength(2)
  const output = page.getByRole('status', { name: 'Delivery methods' })
  await expect.element(output).toBeVisible()
  const methods: DeliveryMethod[] = JSON.parse(output.element().textContent!)
  expect(methods).toEqual([
    { id: expect.any(String), type: DeliveryMethodType.WebApp, enabled: true },
    { id: expect.any(String), type: DeliveryMethodType.Email, enabled: false },
  ])
  expect(methods[0]!.id).not.toBe(methods[1]!.id)
})

it('does not add duplicates when both methods already exist', async () => {
  const initial: DeliveryMethod[] = [
    { id: 'webapp-1', type: DeliveryMethodType.WebApp, enabled: true },
    { id: 'email-1', type: DeliveryMethodType.Email, enabled: false },
  ]
  await renderSelector(initial)
  await page.getByRole('button', { name: 'Add delivery method' }).click()
  await expect.element(page.getByText('Added')).toHaveLength(2)
  await webapp().click()
  await email().click()
  await expect
    .element(page.getByRole('status', { name: 'Delivery methods' }))
    .toHaveTextContent(JSON.stringify(initial))
})

it('guards trigger workflows and routes unavailable email delivery to the upgrade caller', async () => {
  await renderSelector([], true)
  await page.getByRole('button', { name: 'Add delivery method' }).click()
  await expect.element(page.getByText('Unavailable in trigger mode')).toBeVisible()
  await webapp().click()
  await email().click()
  await expect.element(page.getByText('Upgrade requested')).toBeVisible()
  await expect
    .element(page.getByRole('status', { name: 'Delivery methods' }))
    .toHaveTextContent('[]')
})
