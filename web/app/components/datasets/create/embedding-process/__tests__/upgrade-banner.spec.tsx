import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UpgradeBanner from '../upgrade-banner'

vi.mock('@/app/components/base/icons/src/vender/solid/general', () => ({
  ZapFast: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="zap-icon" {...props} />,
}))
vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ loc }: { loc: string }) => <button data-testid="upgrade-btn" data-loc={loc}>Upgrade</button>,
}))

describe('UpgradeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the banner with icon, text, and upgrade button', () => {
    render(<UpgradeBanner />)

    expect(screen.getByTestId('zap-icon')).toBeInTheDocument()
    expect(screen.getByText('billing.plansCommon.documentProcessingPriorityUpgrade')).toBeInTheDocument()
    expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()
  })

  it('should pass correct loc to UpgradeBtn', () => {
    render(<UpgradeBanner />)
    expect(screen.getByTestId('upgrade-btn')).toHaveAttribute('data-loc', 'knowledge-speed-up')
  })
})
