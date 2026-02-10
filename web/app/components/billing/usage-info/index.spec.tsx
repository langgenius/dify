import { render, screen } from '@testing-library/react'
import { NUM_INFINITE } from '../config'
import UsageInfo from './index'

const TestIcon = () => <span data-testid="usage-icon" />

describe('UsageInfo', () => {
  describe('Default Mode (non-storage)', () => {
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

  describe('Storage Mode', () => {
    describe('Below Threshold', () => {
      it('should render indeterminate progress bar when usage is below threshold', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={30}
            total={5120}
            unit="MB"
            storageMode
            storageThreshold={50}
          />,
        )

        expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
        expect(screen.queryByTestId('billing-progress-bar')).not.toBeInTheDocument()
      })

      it('should display "< threshold" format when usage is below threshold (non-sandbox)', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={30}
            total={5120}
            unit="MB"
            unitPosition="inline"
            storageMode
            storageThreshold={50}
            isSandboxPlan={false}
          />,
        )

        // Text "< 50" is rendered inside a single span
        expect(screen.getByText(/< 50/)).toBeInTheDocument()
        expect(screen.getByText('5120MB')).toBeInTheDocument()
      })

      it('should display "< threshold unit" format when usage is below threshold (sandbox)', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={30}
            total={50}
            unit="MB"
            storageMode
            storageThreshold={50}
            isSandboxPlan
          />,
        )

        // Text "< 50" is rendered inside a single span
        expect(screen.getByText(/< 50/)).toBeInTheDocument()
        // Unit "MB" appears in the display
        expect(screen.getAllByText('MB').length).toBeGreaterThanOrEqual(1)
      })

      it('should render full-width indeterminate bar for sandbox users below threshold', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={30}
            total={50}
            unit="MB"
            storageMode
            storageThreshold={50}
            isSandboxPlan
          />,
        )

        const bar = screen.getByTestId('billing-progress-bar-indeterminate')
        expect(bar).toHaveClass('w-full')
      })

      it('should render narrow indeterminate bar for non-sandbox users below threshold', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={30}
            total={5120}
            unit="MB"
            storageMode
            storageThreshold={50}
            isSandboxPlan={false}
          />,
        )

        const bar = screen.getByTestId('billing-progress-bar-indeterminate')
        expect(bar).toHaveClass('w-[30px]')
      })
    })

    describe('Sandbox Full Capacity', () => {
      it('should render error color progress bar when sandbox usage >= threshold', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={50}
            total={50}
            unit="MB"
            storageMode
            storageThreshold={50}
            isSandboxPlan
          />,
        )

        const progressBar = screen.getByTestId('billing-progress-bar')
        expect(progressBar).toHaveClass('bg-components-progress-error-progress')
      })

      it('should display "threshold / threshold unit" format when sandbox is at full capacity', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={50}
            total={50}
            unit="MB"
            storageMode
            storageThreshold={50}
            isSandboxPlan
          />,
        )

        // First span: "50", Third span: "50 MB"
        expect(screen.getByText('50')).toBeInTheDocument()
        expect(screen.getByText(/50 MB/)).toBeInTheDocument()
        expect(screen.getByText('/')).toBeInTheDocument()
      })
    })

    describe('Pro/Team Users Above Threshold', () => {
      it('should render normal progress bar when usage >= threshold', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={100}
            total={5120}
            unit="MB"
            unitPosition="inline"
            storageMode
            storageThreshold={50}
            isSandboxPlan={false}
          />,
        )

        expect(screen.getByTestId('billing-progress-bar')).toBeInTheDocument()
        expect(screen.queryByTestId('billing-progress-bar-indeterminate')).not.toBeInTheDocument()
      })

      it('should display actual usage when usage >= threshold', () => {
        render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={100}
            total={5120}
            unit="MB"
            unitPosition="inline"
            storageMode
            storageThreshold={50}
            isSandboxPlan={false}
          />,
        )

        expect(screen.getByText('100')).toBeInTheDocument()
        expect(screen.getByText('5120MB')).toBeInTheDocument()
      })
    })

    describe('Storage Tooltip', () => {
      it('should render tooltip wrapper when storageTooltip is provided', () => {
        const { container } = render(
          <UsageInfo
            Icon={TestIcon}
            name="Storage"
            usage={30}
            total={5120}
            unit="MB"
            storageMode
            storageThreshold={50}
            storageTooltip="This is a storage tooltip"
          />,
        )

        // Tooltip wrapper should contain cursor-default class
        const tooltipWrapper = container.querySelector('.cursor-default')
        expect(tooltipWrapper).toBeInTheDocument()
      })
    })
  })
})
