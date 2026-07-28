import { toast } from '@langgenius/dify-ui/toast'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Plan } from '@/app/components/billing/type'
import EducationApplyPage from '@/app/education-apply/education-apply-page'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'

let mockProviderContext: Record<string, unknown> = {}
let mockConsoleState: Record<string, unknown> = {}
const mockFetchSubscriptionUrls = vi.hoisted(() => vi.fn())
const mockEducationAdd = vi.hoisted(() => vi.fn())
const mockSwitchWorkspace = vi.hoisted(() => vi.fn())
const mockWorkspaces = vi.hoisted(() => [
  {
    id: 'workspace-1',
    name: 'Workspace One',
    current: true,
    plan: 'sandbox',
  },
  {
    id: 'workspace-2',
    name: 'Workspace Two',
    current: false,
    plan: 'sandbox',
  },
])

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContext,
}))

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=education-token'),
}))

vi.mock('@/service/billing', () => ({
  fetchSubscriptionUrls: (...args: unknown[]) => mockFetchSubscriptionUrls(...args),
}))

vi.mock('@/service/use-education', () => ({
  useEducationAdd: () => ({ isPending: false, mutateAsync: mockEducationAdd }),
  useInvalidateEducationStatus: () => vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => vi.fn(),
}))

vi.mock('@/app/education-apply/storage', () => ({
  useSetEducationVerifying: () => vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    billing: {
      invoices: {
        get: vi.fn().mockResolvedValue({ url: 'https://billing.example.com' }),
      },
    },
  },
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['system-features'],
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ['system-features'],
          ...options,
        }),
      },
    },
    workspaces: {
      get: {
        queryOptions: () => ({
          queryKey: ['workspaces'],
          queryFn: async () => ({ workspaces: mockWorkspaces }),
        }),
      },
      switch: {
        post: {
          mutationOptions: () => ({ mutationFn: mockSwitchWorkspace }),
        },
      },
    },
  },
}))

const setupContext = (isCurrentWorkspaceManager: boolean) => {
  mockProviderContext = {
    plan: { type: Plan.sandbox },
    isEducationAccount: true,
    onPlanInfoChanged: vi.fn(),
  }
  mockConsoleState = {
    currentWorkspace: { id: 'workspace-1', name: 'Workspace One' },
    isCurrentWorkspaceManager,
    userProfile: {
      name: 'Student',
      email: 'student@university.edu',
      avatar_url: '',
    },
  }
}

const renderPage = () => {
  const { wrapper } = createConsoleQueryWrapper({ workspacePermissionKeys: null })
  return render(<EducationApplyPage />, {
    wrapper,
  })
}

describe('EducationApplyPage billing boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    mockFetchSubscriptionUrls.mockResolvedValue({ url: window.location.href })
    mockSwitchWorkspace.mockResolvedValue(undefined)
    vi.stubGlobal('location', {
      href: 'https://console.example.com/education-apply?token=education-token',
      reload: vi.fn(),
    } as unknown as Location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lets workspace managers apply the education coupon at checkout', async () => {
    setupContext(true)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'education.useEducationDiscount' }))

    await waitFor(() => {
      expect(mockFetchSubscriptionUrls).toHaveBeenCalledWith(Plan.professional, 'year')
    })
  })

  it('shows non-manager members that they cannot apply the coupon to payment', () => {
    setupContext(false)
    renderPage()

    expect(
      screen.getByText('education.applied.noPaymentPermission.description'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'education.useEducationDiscount' }),
    ).not.toBeInTheDocument()
  })

  it('reloads the current URL after switching workspaces', async () => {
    setupContext(true)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /Workspace Two/ }))

    await waitFor(() => {
      expect(mockSwitchWorkspace.mock.calls[0]?.[0]).toEqual({
        body: { tenant_id: 'workspace-2' },
      })
      expect(globalThis.location.reload).toHaveBeenCalledTimes(1)
    })
  })

  it('disables workspace selection while switching and recovers after a failure', async () => {
    setupContext(true)
    let rejectSwitch!: (error: Error) => void
    mockSwitchWorkspace.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSwitch = reject
        }),
    )
    const user = userEvent.setup()
    renderPage()

    const selector = await screen.findByRole('combobox')
    await user.click(selector)
    await user.click(await screen.findByRole('option', { name: /Workspace Two/ }))

    await waitFor(() => {
      expect(selector).toBeDisabled()
    })

    rejectSwitch(new Error('switch failed'))

    await waitFor(() => {
      expect(selector).toBeEnabled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('common.actionMsg.modifiedUnsuccessfully')
    })
    expect(globalThis.location.reload).not.toHaveBeenCalled()
  })
})
