import { render, screen } from '@testing-library/react'
import { NUM_INFINITE } from '../config'
import UsageInfo from './index'

const TestIcon = () => <span data-testid="usage-icon" />

describe('UsageInfo', () => {
  it('renders the metric with a suffix unit and tooltip text', () => {
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Apps"
        usage={30}
        total={100}
        unit="GB"
        tooltip="tooltip text"
      />,
    )

    expect(screen.getByTestId('usage-icon')).toBeInTheDocument()
    expect(screen.getByText('Apps')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('GB')).toBeInTheDocument()
  })

  it('renders inline unit when unitPosition is inline', () => {
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Storage"
        usage={20}
        total={100}
        unit="GB"
        unitPosition="inline"
      />,
    )

    expect(screen.getByText('100GB')).toBeInTheDocument()
  })

  it('shows reset hint text instead of the unit when resetHint is provided', () => {
    const resetHint = 'Resets in 3 days'
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Storage"
        usage={20}
        total={100}
        unit="GB"
        resetHint={resetHint}
      />,
    )

    expect(screen.getByText(resetHint)).toBeInTheDocument()
    expect(screen.queryByText('GB')).not.toBeInTheDocument()
  })

  it('displays unlimited text when total is infinite', () => {
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Storage"
        usage={10}
        total={NUM_INFINITE}
        unit="GB"
      />,
    )

    expect(screen.getByText('billing.plansCommon.unlimited')).toBeInTheDocument()
  })

  it('applies warning color when usage is close to the limit', () => {
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Storage"
        usage={85}
        total={100}
      />,
    )

    const progressBar = screen.getByTestId('billing-progress-bar')
    expect(progressBar).toHaveClass('bg-components-progress-warning-progress')
  })

  it('applies error color when usage exceeds the limit', () => {
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Storage"
        usage={120}
        total={100}
      />,
    )

    const progressBar = screen.getByTestId('billing-progress-bar')
    expect(progressBar).toHaveClass('bg-components-progress-error-progress')
  })

  it('does not render the icon when hideIcon is true', () => {
    render(
      <UsageInfo
        Icon={TestIcon}
        name="Storage"
        usage={5}
        total={100}
        hideIcon
      />,
    )

    expect(screen.queryByTestId('usage-icon')).not.toBeInTheDocument()
  })
})
