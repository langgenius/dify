import { render, screen } from '@testing-library/react'
import VectorSpaceAdmissionAlert from '../vector-space-admission-alert'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'datasetDocuments.embedding.vectorSpaceEstimateExceeded.description':
      'After upload total {{estimated}}MB / plan limit {{limit}}MB',
  })
})

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <button>upgrade plan</button>,
}))

describe('VectorSpaceAdmissionAlert', () => {
  it('does not suggest an unavailable upgrade', () => {
    render(<VectorSpaceAdmissionAlert showUpgrade={false} estimatedMb={61} planLimitMb={50} />)

    expect(screen.getByText('After upload total 61MB / plan limit 50MB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'upgrade plan' })).not.toBeInTheDocument()
  })

  it('offers an upgrade when the current plan has one', () => {
    render(<VectorSpaceAdmissionAlert showUpgrade estimatedMb={61} planLimitMb={50} />)

    expect(screen.getByText('After upload total 61MB / plan limit 50MB')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'upgrade plan' })).toBeInTheDocument()
  })
})
