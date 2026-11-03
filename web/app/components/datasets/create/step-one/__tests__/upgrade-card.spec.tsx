import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import UpgradeCard from '../upgrade-card'

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithConsoleQuery, () => ({ onUrlUpdate }))

it('opens pricing from the multiple-file upload upgrade action', async () => {
  const user = userEvent.setup()
  render(<UpgradeCard />, { systemFeatures: { deployment_edition: 'CLOUD' } })
  await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
  )
})

it('does not offer a Cloud upgrade on a community deployment', () => {
  render(<UpgradeCard />, { systemFeatures: { deployment_edition: 'COMMUNITY' } })
  expect(
    screen.queryByRole('button', { name: 'billing.triggerLimitModal.upgrade' }),
  ).not.toBeInTheDocument()
})
