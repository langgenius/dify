import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { GeneratedMetricCard } from '../components/metric-card'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: translations } = await import('@/i18n/locales/en-US/app-debug.json')
  return createReactI18nextMock(translations)
})

describe('GeneratedMetricCard', () => {
  it('shows an unspecified comparison period without assuming monthly data', () => {
    render(
      <GeneratedMetricCard title="Annual revenue" value={1200} previousValue={1000} unit="USD" />,
    )

    const card = within(screen.getByRole('figure', { name: 'Annual revenue' }))
    expect(card.getByText('1,200')).toBeVisible()
    expect(card.getByText('USD')).toBeVisible()
    expect(card.getByText('Previous value: 1,000 USD')).toBeVisible()
    expect(card.getByText('vs. previous period')).toBeVisible()
    expect(card.getByText('+20%')).toBeVisible()
    expect(card.getByText('Improved')).toBeVisible()
  })

  it('identifies a falling revenue metric as a decline', () => {
    render(<GeneratedMetricCard title="Revenue" value={75} previousValue={100} />)

    expect(screen.getByText('-25%')).toBeVisible()
    expect(screen.getByText('Declined')).toBeVisible()
  })

  it('identifies a falling cost metric as an improvement', () => {
    render(
      <GeneratedMetricCard
        title="Response time"
        value={75}
        previousValue={100}
        unit="ms"
        higherIsBetter={false}
      />,
    )

    expect(screen.getByText('-25%')).toBeVisible()
    expect(screen.getByText('Improved')).toBeVisible()
    expect(screen.queryByText('Declined')).not.toBeInTheDocument()
  })

  it.each([0, 100])('shows an unchanged metric without claiming improvement from %s', (value) => {
    render(<GeneratedMetricCard title="Orders" value={value} previousValue={value} />)

    expect(screen.getByText('0%')).toBeVisible()
    expect(screen.getByText('Unchanged')).toBeVisible()
    expect(screen.queryByText('Improved')).not.toBeInTheDocument()
    expect(screen.queryByText('Declined')).not.toBeInTheDocument()
  })

  it('explains why a percentage cannot be calculated from a zero baseline', () => {
    render(<GeneratedMetricCard title="Orders" value={20} previousValue={0} />)

    expect(screen.getByText('20')).toBeVisible()
    expect(screen.getByText('Previous value: 0')).toBeVisible()
    expect(screen.getByText('Percentage unavailable: previous value is zero')).toBeVisible()
    expect(screen.queryByText(/%|Infinity|NaN/)).not.toBeInTheDocument()
  })

  it('uses the magnitude of a negative baseline when comparing a loss', () => {
    render(<GeneratedMetricCard title="Net result" value={-50} previousValue={-100} />)

    expect(screen.getByText('+50%')).toBeVisible()
    expect(screen.getByText('Improved')).toBeVisible()
  })

  it('uses the supplied comparison period', () => {
    render(
      <GeneratedMetricCard
        title="Revenue"
        value={120}
        previousValue={100}
        comparisonLabel="vs. September"
      />,
    )

    expect(screen.getByText('vs. September')).toBeVisible()
    expect(screen.queryByText('vs. previous period')).not.toBeInTheDocument()
  })
})
