import type { Mock } from 'vite-plus/test'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useGetPricingPageLanguage } from '@/context/i18n'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import Pricing from '../index'

let mockConsoleState: Record<string, unknown> = {}

vi.mock('../content', () => ({
  PricingContent: () => <div>pricing-content</div>,
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useGetPricingPageLanguage: vi.fn(),
}))

describe('Pricing dialog lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState = {
      isCurrentWorkspaceManager: true,
    }
    ;(useGetPricingPageLanguage as Mock).mockReturnValue('en')
  })

  it('should call onCancel when the pricing dialog is closed', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { wrapper } = createConsoleQueryWrapper()
    render(<Pricing onCancel={onCancel} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
