import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import VectorSpaceAdmissionAlert from '../vector-space-admission-alert'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'datasetDocuments.embedding.vectorSpaceEstimateExceeded.description':
      'After upload total {{estimated}}MB / plan limit {{limit}}MB',
  })
})

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(
  (ui: React.ReactElement) =>
    renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: 'CLOUD' } }),
  () => ({ onUrlUpdate }),
)

describe('VectorSpaceAdmissionAlert', () => {
  it('does not suggest an unavailable upgrade', () => {
    render(<VectorSpaceAdmissionAlert showUpgrade={false} estimatedMb={61} planLimitMb={50} />)

    expect(screen.getByText('After upload total 61MB / plan limit 50MB')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourage' }),
    ).not.toBeInTheDocument()
  })

  it('opens pricing when an upgrade is available', async () => {
    const user = userEvent.setup()
    render(<VectorSpaceAdmissionAlert showUpgrade estimatedMb={61} planLimitMb={50} />)

    expect(screen.getByText('After upload total 61MB / plan limit 50MB')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourage' }))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })
})
