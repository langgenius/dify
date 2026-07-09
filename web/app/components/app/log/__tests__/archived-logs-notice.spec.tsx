import type { AppContextStateMockState } from '@/__tests__/utils/mock-app-context-state'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { ArchivedLogsNotice } from '../archived-logs-notice'

const mockAppContextState = vi.hoisted(() => ({
  current: null as AppContextStateMockState | null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
  }
})

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current ?? {})
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/provider-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/provider-context')>()
  return {
    ...actual,
    useProviderContext: vi.fn(),
  }
})

vi.mock('@/context/modal-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/modal-context')>()
  return {
    ...actual,
    useModalContextSelector: vi.fn(),
  }
})

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseModalContextSelector = vi.mocked(useModalContextSelector)

function mockProviderPlan(planType: Plan) {
  mockUseProviderContext.mockReturnValue(createMockProviderContextValue({
    enableBilling: true,
    plan: {
      ...defaultPlan,
      type: planType,
    },
  }))
}

describe('ArchivedLogsNotice', () => {
  const setShowAccountSettingModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState.current = {
      isCurrentWorkspaceManager: true,
    }
    mockProviderPlan(Plan.professional)
    mockUseModalContextSelector.mockImplementation(selector =>
      selector({
        setShowAccountSettingModal,
      } as unknown as Parameters<typeof selector>[0]),
    )
  })

  it('should show notice for paid workspace managers', () => {
    render(<ArchivedLogsNotice />)

    expect(screen.getByText('archives.notice.description')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'archives.notice.action' }))
    expect(setShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
    })
  })

  it('should not show notice for sandbox workspaces', () => {
    mockProviderPlan(Plan.sandbox)

    render(<ArchivedLogsNotice />)

    expect(screen.queryByText('archives.notice.description')).not.toBeInTheDocument()
  })
})
