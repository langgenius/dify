import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { UsagePlanInfo } from '../../type'
import { render } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '../../type'
import Pricing from '../index'

type DialogProps = {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: DialogProps['onOpenChange']

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: DialogProps) => {
    latestOnOpenChange = onOpenChange
    return <div data-testid="dialog">{children}</div>
  },
  DialogContent: ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('../header', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button data-testid="pricing-header-close" onClick={onClose}>close</button>
  ),
}))

vi.mock('../plan-switcher', () => ({
  default: () => <div>plan-switcher</div>,
}))

vi.mock('../plans', () => ({
  default: () => <div>plans</div>,
}))

vi.mock('../footer', () => ({
  default: () => <div>footer</div>,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetPricingPageLanguage: vi.fn(),
}))

const buildUsage = (): UsagePlanInfo => ({
  buildApps: 0,
  teamMembers: 0,
  annotatedResponse: 0,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
  vectorSpace: 0,
})

describe('Pricing dialog lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
    ;(useAppContext as Mock).mockReturnValue({ isCurrentWorkspaceManager: true })
    ;(useProviderContext as Mock).mockReturnValue({
      plan: {
        type: Plan.sandbox,
        usage: buildUsage(),
        total: buildUsage(),
      },
    })
    ;(useGetPricingPageLanguage as Mock).mockReturnValue('en')
  })

  it('should only call onCancel when the dialog requests closing', () => {
    const onCancel = vi.fn()
    render(<Pricing onCancel={onCancel} />)

    latestOnOpenChange?.(true)
    latestOnOpenChange?.(false)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
