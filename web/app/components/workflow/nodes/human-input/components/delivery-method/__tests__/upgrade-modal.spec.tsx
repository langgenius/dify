import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { UpgradeModal } from '../upgrade-modal'

it('renders upgrade copy and handles hide and pricing actions', async () => {
  const user = userEvent.setup()
  const onUrlUpdate = vi.fn()
  const onOpenChange = vi.fn()
  renderWithConsoleQuery(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <UpgradeModal open onOpenChange={onOpenChange} />
    </NuqsTestingAdapter>,
    { systemFeatures: { deployment_edition: 'CLOUD' } },
  )
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'workflow.nodes.humanInput.deliveryMethod.upgradeTipContent',
  )
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInput.deliveryMethod.upgradeTipHide' }),
  )
  expect(onOpenChange).toHaveBeenCalledWith(false)
  await user.click(screen.getByRole('button', { name: /billing.upgradeBtn.encourageShort/i }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
  )
})
