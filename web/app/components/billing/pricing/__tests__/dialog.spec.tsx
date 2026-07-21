import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { UsagePlanInfo } from '../../type'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { render } from '@/test/console/render'
import { Plan } from '../../type'
import Pricing from '../index'

type DialogProps = {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: DialogProps['onOpenChange']
let mockConsoleState: Record<string, unknown> = {}

vi.mock('@langgenius/dify-ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: DialogProps) => {
    latestOnOpenChange = onOpenChange
    return <div>{children}</div>
  },
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('../header', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      close
    </button>
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

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

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
    mockConsoleState = {
      isCurrentWorkspaceManager: true,
      workspacePermissionKeys: ['billing.manage'],
    }
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
