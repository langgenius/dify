import type { Mock } from 'vite-plus/test'
import type { UsagePlanInfo } from '../../type'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import Pricing from '../index'

let mockConsoleState: Record<string, unknown> = {}

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
    mockConsoleState = {
      isCurrentWorkspaceManager: true,
    }
    ;(useProviderContext as Mock).mockReturnValue({
      enableEducationPlan: false,
      plan: {
        type: 'sandbox',
        usage: buildUsage(),
        total: buildUsage(),
      },
    })
    ;(useGetPricingPageLanguage as Mock).mockReturnValue('en')
  })

  it('should call onCancel when the pricing dialog is closed', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { wrapper } = createConsoleQueryWrapper()
    render(<Pricing onCancel={onCancel} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'close' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
